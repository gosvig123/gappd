package service

import (
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

// keyRetry bounds how often a failed fetch is retried, so an issuer outage does not get one fetch per request.
const keyRetry = 10 * time.Second

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

// lookup keeps the last good key set when a refresh fails. The fetch does not use the request
// context, so one caller that disconnects cannot fail the refresh for everyone else.
func (k *Keys) lookup(id string) (*rsa.PublicKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if time.Now().After(k.next) {
		if set, err := k.fetch(); err == nil {
			k.set, k.next = set, time.Now().Add(keyTTL)
		} else {
			k.next = time.Now().Add(keyRetry)
		}
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

func (k *Keys) fetch() (jwk.Set, error) {
	req, err := http.NewRequest(http.MethodGet, k.URL, nil)
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
