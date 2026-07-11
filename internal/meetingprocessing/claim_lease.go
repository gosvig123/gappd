package meetingprocessing

import (
	"context"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func (s Service) maintainClaim(ctx context.Context, store *db.DB, claim *db.ProcessingClaim) func() {
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go s.renewClaim(ctx, store, claim, done)
	return func() { cancel(); <-done }
}

func (s Service) renewClaim(ctx context.Context, store *db.DB, claim *db.ProcessingClaim, done chan<- struct{}) {
	defer close(done)
	ticker := time.NewTicker(claimTTL / 4)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			ok, err := store.RenewClaim(ctx, claim.Meeting.ID, claim.Token, s.now(), claimTTL)
			if err != nil {
				continue
			}
			if !ok {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
