package service_test

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// clientHost serves the read and write routes and records the clients that use them.
func clientHost(t *testing.T) (*httptest.Server, *pgxpool.Pool, *service.ClientDirectory, tokenMinter) {
	t.Helper()
	reader, writer := meetingDatabase(t)
	auth, mint := revokeAuth(t)
	auth.Revocations = service.NewRevocations(reader)
	auth.Clients = service.NewClientDirectory(writer)
	// Revocation is checked immediately here, so a pick-list test is not racing the cache.
	auth.Revocations.TTL = 0
	host := httptest.NewServer(service.HandlerWithUploads(auth, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	t.Cleanup(host.Close)
	return host, writer, auth.Clients, mint
}

// waitForClients gives the background record a moment to land.
func waitForClients(t *testing.T, directory *service.ClientDirectory, owner string, want int) []service.AccountClient {
	t.Helper()
	for attempt := 0; attempt < 40; attempt++ {
		clients, err := directory.Clients(context.Background(), owner)
		if err != nil {
			t.Fatal(err)
		}
		if len(clients) >= want {
			return clients
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("expected %d clients, none arrived", want)
	return nil
}

func TestAClientIsRecordedOnFirstUse(t *testing.T) {
	host, _, directory, mint := clientHost(t)
	owner := copyOwner("directory")
	token := mint(service.Scope, "pi", owner)
	session := connect(t, host.URL+"/mcp", &token)
	if _, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_meetings", Arguments: map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	clients := waitForClients(t, directory, owner, 1)
	if clients[0].ClientID != "pi" || clients[0].FirstSeenAt.IsZero() {
		t.Fatalf("client: %+v", clients[0])
	}
	// A token with no client claim is not a pickable client.
	if _, err := session.ListTools(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if clients := waitForClients(t, directory, owner, 1); len(clients) != 1 {
		t.Fatalf("an empty client id was recorded: %+v", clients)
	}
}

func TestTheDirectoryIsPerAccountAndOrderedByRecentUse(t *testing.T) {
	host, _, directory, mint := clientHost(t)
	owner, other := copyOwner("directory-a"), copyOwner("directory-b")
	for _, client := range []string{"chatgpt", "pi"} {
		token := mint(service.Scope, client, owner)
		session := connect(t, host.URL+"/mcp", &token)
		if _, err := session.ListTools(context.Background(), nil); err != nil {
			t.Fatal(err)
		}
	}
	otherToken := mint(service.Scope, "desktop", other)
	otherSession := connect(t, host.URL+"/mcp", &otherToken)
	if _, err := otherSession.ListTools(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	clients := waitForClients(t, directory, owner, 2)
	if len(clients) != 2 {
		t.Fatalf("clients: %+v", clients)
	}
	// The most recently used client comes first.
	if clients[0].ClientID != "pi" {
		t.Fatalf("order: %+v", clients)
	}
	// The other account's write is also asynchronous, so wait for it rather than reading once.
	if mine := waitForClients(t, directory, other, 1); mine[0].ClientID != "desktop" {
		t.Fatalf("another account: %+v", mine)
	}
}

func TestTheClientsRouteListsAndNeedsADevice(t *testing.T) {
	host, _, directory, mint := clientHost(t)
	owner := copyOwner("directory-route")
	// Record one client directly, then read it back through the route.
	directory.Record(owner, "pi", time.Now())
	waitForClients(t, directory, owner, 1)
	token := mint("meetings:sync", "desktop", owner)
	testDevice.register(t, host.URL, token)
	code, ack := postRaw(t, host.URL+"/clients", token, "", testDevice.sign("POST", "/clients", "", []byte("")))
	if code != 200 {
		t.Fatalf("clients route returned %d", code)
	}
	// The desktop client appears too, because registering and listing are its own requests.
	clients, _ := ack["clients"].([]any)
	if len(clients) != 2 {
		t.Fatalf("clients: %v", ack)
	}
	ids := map[string]bool{}
	for _, raw := range clients {
		entry, _ := raw.(map[string]any)
		ids[entry["client_id"].(string)] = true
	}
	if !ids["pi"] || !ids["desktop"] {
		t.Fatalf("clients: %v", ids)
	}
	if code, _ := postRaw(t, host.URL+"/clients", token, "", nil); code != 403 {
		t.Fatalf("an unsigned list returned %d", code)
	}
}

func TestRevokingAPickedClientStopsIt(t *testing.T) {
	host, _, directory, mint := clientHost(t)
	owner := copyOwner("directory-revoke")
	readToken := mint(service.Scope, "pi", owner)
	session := connect(t, host.URL+"/mcp", &readToken)
	if _, err := session.ListTools(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	clients := waitForClients(t, directory, owner, 1)
	// The pick-list feeds the same revocation the user already had.
	if code := revokeClient(t, host.URL, mint("meetings:sync", "desktop", owner), clients[0].ClientID); code != 200 {
		t.Fatalf("revoke returned %d", code)
	}
	if code := mcpStatus(t, host.URL, readToken); code != 401 {
		t.Fatalf("a picked client survived revocation: %d", code)
	}
}
