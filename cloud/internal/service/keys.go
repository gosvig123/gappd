package service

import (
	"context"
	"crypto/rsa"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwk"
)

const keyTTL = 5 * time.Minute
const maxJWKSBytes = 128 << 10

type Keys struct {
	URL    string
	Client *http.Client
	mu     sync.Mutex
	set    jwk.Set
	next   time.Time
}

func NewKeys(issuer string) *Keys {
	return &Keys{URL: issuer + "/.well-known/jwks.json", Client: &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (k *Keys) lookup(ctx context.Context, id string) (*rsa.PublicKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if time.Now().After(k.next) {
		k.next = time.Now().Add(keyTTL)
		k.set = nil
		set, err := k.fetch(ctx)
		if err != nil {
			return nil, err
		}
		k.set = set
	}
	if k.set == nil {
		return nil, errors.New("keys unavailable")
	}
	key, ok := k.set.LookupKeyID(id)
	if !ok {
		return nil, errors.New("unknown key")
	}
	return rsaKey(key)
}

func rsaKey(key jwk.Key) (*rsa.PublicKey, error) {
	var exported any
	if err := jwk.Export(key, &exported); err != nil {
		return nil, err
	}
	raw, ok := exported.(*rsa.PublicKey)
	if !ok || raw.N.BitLen() < 2048 {
		return nil, errors.New("weak key")
	}
	return raw, nil
}

func (k *Keys) fetch(ctx context.Context) (jwk.Set, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.URL, nil)
	if err != nil {
		return nil, err
	}
	res, err := k.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("keys unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxJWKSBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxJWKSBytes {
		return nil, errors.New("keys too large")
	}
	return jwk.Parse(data)
}
