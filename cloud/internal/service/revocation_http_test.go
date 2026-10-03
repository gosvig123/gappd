package service_test

import (
	"net/http"
	"strings"
	"testing"
)

// postRevoke signs its request. postRevokeUnsigned sends one with no device, for refusal cases.
func postRevokeUnsigned(t *testing.T, host, syncToken, body string) int {
	t.Helper()
	request, err := http.NewRequest("POST", host+"/revoke", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if syncToken != "" {
		request.Header.Set("Authorization", "Bearer "+syncToken)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	return response.StatusCode
}

func postRevoke(t *testing.T, host, syncToken, body string) int {
	t.Helper()
	if syncToken != "" {
		testDevice.register(t, host, syncToken)
	}
	request, err := http.NewRequest("POST", host+"/revoke", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if syncToken != "" {
		request.Header.Set("Authorization", "Bearer "+syncToken)
		for name, values := range testDevice.sign("POST", "/revoke", "", []byte(body)) {
			if values[0] != "" {
				request.Header.Set(name, values[0])
			}
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	return response.StatusCode
}

func revokeClient(t *testing.T, host, syncToken, client string) int {
	t.Helper()
	return postRevoke(t, host, syncToken, `{"client_id":"`+client+`"}`)
}
