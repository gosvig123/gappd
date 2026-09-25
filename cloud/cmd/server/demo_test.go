package main

import "testing"

func TestDemoDisabledNeedsNoWriterConfiguration(t *testing.T) {
	t.Setenv("SYNTHETIC_UPLOAD_DATABASE_URL", "invalid")
	t.Setenv("GAPPD_DESKTOP_OAUTH_CLIENT_ID", "")
	for _, enabled := range []string{"", "false", "TRUE", "1"} {
		t.Setenv("GAPPD_SYNTHETIC_UPLOAD_ENABLED", enabled)
		pool, err := demoPool()
		if pool != nil || err != nil {
			t.Fatal("disabled capability used writer configuration")
		}
	}
	t.Setenv("GAPPD_SYNTHETIC_UPLOAD_ENABLED", "true")
	if _, err := demoPool(); err == nil {
		t.Fatal("enabled without client identity")
	}
	t.Setenv("GAPPD_DESKTOP_OAUTH_CLIENT_ID", "desktop")
	t.Setenv("SYNTHETIC_UPLOAD_DATABASE_URL", "")
	if _, err := demoPool(); err == nil {
		t.Fatal("enabled without writer")
	}
}
