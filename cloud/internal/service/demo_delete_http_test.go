package service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
)

func TestDemoDeleteHTTPAuthorizationAndGenericAcknowledgment(t *testing.T) {
	reader, writer := demoDatabase(t)
	auth, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithDemo(auth, reader, writer, "desktop"))
	defer host.Close()
	owner := "http-delete-" + time.Now().Format("150405.000000000")
	if _, err := service.CreateDemo(context.Background(), writer, owner); err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"", "invalid"} {
		deleteRequest(t, host.URL, token, "", 401)
	}
	deleteRequest(t, host.URL, sign(owner), `{"id":"arbitrary","revision":999999}`, 400)
	first := deleteRequest(t, host.URL, sign(owner), "", 200)
	again := deleteRequest(t, host.URL, sign(owner), "", 200)
	if first["status"] != "deleted" || len(first) != 2 || first["subject"] != owner || again["status"] != first["status"] {
		t.Fatal("non-generic acknowledgment")
	}
	assertDeleted(t, reader, writer, owner)
	checkOtherOwnerDelete(t, host.URL, sign, owner)
}

func deleteRequest(t *testing.T, host, token, body string, want int) map[string]string {
	t.Helper()
	request, _ := http.NewRequest("DELETE", host+"/demo-meeting", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("DELETE status %d want %d", response.StatusCode, want)
	}
	result := map[string]string{}
	if want == 200 {
		if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
	}
	return result
}

func checkOtherOwnerDelete(t *testing.T, host string, sign func(string) string, owner string) {
	t.Helper()
	conn := lifecycleAdmin(t)
	collisionOwner := owner + "-collision"
	mustExec(t, conn, `INSERT INTO meetings VALUES ($1,'other-owner','SYNTHETIC collision','','',now(),now(),true)`, service.DemoMeetingID(collisionOwner))
	result := deleteRequest(t, host, sign(collisionOwner), "", 200)
	if result["status"] != "deleted" || len(result) != 2 {
		t.Fatal("collision leaked")
	}
	var exists bool
	err := conn.QueryRow(context.Background(), `SELECT EXISTS(SELECT FROM meetings WHERE id=$1 AND owner_id='other-owner')`, service.DemoMeetingID(collisionOwner)).Scan(&exists)
	if err != nil || !exists {
		t.Fatal("other owner changed", err)
	}
}
