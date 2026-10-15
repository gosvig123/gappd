package service

import (
	"testing"
	"time"
)

func TestLimiterAllowsTheBurstThenRefuses(t *testing.T) {
	l := NewLimiter()
	l.ReadBurst, l.WriteBurst = 3, 1
	for i := 0; i < 3; i++ {
		if !l.allow(ClassRead, "owner-a") {
			t.Fatalf("read %d refused inside the burst", i)
		}
	}
	if l.allow(ClassRead, "owner-a") {
		t.Fatal("read allowed past the burst")
	}
	// Budgets are per account and per class.
	if !l.allow(ClassRead, "owner-b") {
		t.Fatal("another account shares the budget")
	}
	if !l.allow(ClassWrite, "owner-a") {
		t.Fatal("read budget consumed the write budget")
	}
	if l.allow(ClassWrite, "owner-a") {
		t.Fatal("write allowed past the burst")
	}
}

func TestLimiterRefillsWithTime(t *testing.T) {
	l := NewLimiter()
	l.ReadBurst, l.WriteBurst = 60, 60
	now := time.Unix(1_700_000_000, 0)
	l.now = func() time.Time { return now }
	for i := 0; i < 60; i++ {
		if !l.allow(ClassRead, "owner-a") {
			t.Fatal("burst refused early")
		}
	}
	if l.allow(ClassRead, "owner-a") {
		t.Fatal("refilled without waiting")
	}
	now = now.Add(time.Second)
	if !l.allow(ClassRead, "owner-a") {
		t.Fatal("one second of refill did not restore a request")
	}
	now = now.Add(time.Hour)
	for i := 0; i < 60; i++ {
		if !l.allow(ClassRead, "owner-a") {
			t.Fatal("a long wait did not refill the bucket")
		}
	}
	if l.allow(ClassRead, "owner-a") {
		t.Fatal("bucket grew past its burst")
	}
}

func TestLimiterFailsClosedWithoutABudgetOrSubject(t *testing.T) {
	l := NewLimiter()
	l.ReadBurst = 0
	if l.allow(ClassRead, "owner-a") {
		t.Fatal("an empty budget allowed a request")
	}
	l.ReadBurst = 10
	if l.allow(ClassRead, "") {
		t.Fatal("a request without an account was allowed")
	}
}
