package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// identityServer answers the connection-identity routes and records what was
// sent. One personal connection "prod" with two links; ann's waits for its grant.
func identityServer(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	var calls []string
	ok := func(w http.ResponseWriter, data any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	}
	fail := func(w http.ResponseWriter, status int, code, message string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error": map[string]any{"code": code, "message": message}})
	}
	links := map[string]any{
		"bindings": []any{
			map[string]any{"id": "b-ann", "userId": "u-ann", "accountName": "ann.lee", "accountEmail": "ann.lee@example.com", "clickhouseUser": "alice", "state": "pending_grant", "reason": "Waiting for a ClickHouse administrator to run the grant for alice."},
			map[string]any{"id": "b-ben", "userId": "u-ben", "accountName": "ben.ortiz", "accountEmail": "ben.ortiz@example.com", "clickhouseUser": "bob", "state": "active", "reason": nil},
		},
		"grants":          []any{"GRANT IMPERSONATE ON alice TO chouse_impersonate;  -- ann.lee"},
		"unbound":         []any{map[string]any{"user": "old", "revoke": "REVOKE IMPERSONATE ON old FROM chouse_impersonate;"}},
		"readiness":       map[string]any{"counts": map[string]any{"active": 1, "pending_grant": 1}, "jobsWithoutLink": 0},
		"personalSupport": map[string]any{"kind": "personal", "state": "available", "reason": "ok"},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		calls = append(calls, strings.TrimSpace(r.Method+" "+r.URL.Path+" "+string(raw)))
		switch {
		case r.URL.Path == "/api/rbac/connections/my":
			ok(w, []any{map[string]any{"id": prodID, "name": "prod", "host": "ch.prod"}, map[string]any{"id": draftID, "name": "draft", "host": "ch.draft"}})
		case r.URL.Path == "/api/rbac/connections/identity/mine":
			ok(w, map[string]any{"identities": []any{
				map[string]any{"connectionId": prodID, "connectionName": "prod", "kind": "personal", "runsAs": map[string]any{"type": "user", "name": "alice"}, "state": "ready", "detail": nil, "limits": []any{"SET and USE are refused."}},
				map[string]any{"connectionId": "c-twin-1", "connectionName": "Twin", "kind": "shared", "runsAs": map[string]any{"type": "login", "name": "default"}, "state": "ready", "detail": nil, "limits": []any{}},
				map[string]any{"connectionId": "c-twin-2", "connectionName": "twin", "kind": "shared", "runsAs": map[string]any{"type": "login", "name": "default"}, "state": "ready", "detail": nil, "limits": []any{}},
				map[string]any{"connectionId": "c-wait", "connectionName": "Archive", "kind": "personal", "runsAs": map[string]any{"type": "user", "name": "dave"}, "state": "pending_grant", "detail": "Your link is waiting.", "limits": []any{}},
			}})
		case r.URL.Path == "/api/rbac/connections/"+prodID+"/identity" && r.Method == "GET":
			ok(w, map[string]any{"identityMode": "personal", "username": "svc_personal", "health": "ok", "support": map[string]any{"serverVersion": "26.3.63.123"}})
		case r.URL.Path == "/api/rbac/connections/"+prodID+"/identity/recheck" && r.Method == "POST":
			ok(w, map[string]any{"verdict": map[string]any{"ok": true}})
		case r.URL.Path == "/api/rbac/connections/"+draftID+"/identity/recheck" && r.Method == "POST":
			ok(w, map[string]any{"verdict": map[string]any{"ok": false, "reason": "The login holds a direct grant."}})
		case r.URL.Path == "/api/rbac/clickhouse-bindings/connection/"+draftID && r.Method == "GET":
			ok(w, map[string]any{"bindings": []any{}, "grants": []any{"GRANT IMPERSONATE ON alice TO <impersonation role>;  -- ann.lee"}, "unbound": []any{}})
		case r.URL.Path == "/api/rbac/users/"+eveID:
			ok(w, map[string]any{"user": map[string]any{"id": eveID, "username": "eve.park"}})
		case r.URL.Path == "/api/rbac/clickhouse-bindings/connection/"+prodID && r.Method == "GET":
			ok(w, links)
		case r.URL.Path == "/api/rbac/clickhouse-bindings/connection/"+prodID && r.Method == "POST":
			if strings.Contains(string(raw), "carol") {
				fail(w, 422, "BINDING_USER_NOT_FOUND", "There is no ClickHouse user named carol on this connection.")
				return
			}
			w.WriteHeader(http.StatusCreated)
			ok(w, map[string]any{"binding": map[string]any{"id": "b-new", "accountName": "eve.park", "clickhouseUser": "erin", "state": "pending_grant"}})
		case r.URL.Path == "/api/rbac/clickhouse-bindings/b-ann/recheck":
			ok(w, map[string]any{"binding": map[string]any{"id": "b-ann", "accountName": "ann.lee", "clickhouseUser": "alice", "state": "active"}})
		case r.URL.Path == "/api/rbac/clickhouse-bindings/b-ben" && r.Method == "DELETE":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true}`))
		case r.URL.Path == "/api/rbac/users":
			ok(w, map[string]any{"users": []any{
				map[string]any{"id": "u-eve", "username": "eve.park", "email": "eve.park@example.com"},
				map[string]any{"id": "u-steve", "username": "steve.park", "email": "steve@example.com"},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func sent(calls *[]string, prefix string) []string {
	var out []string
	for _, call := range *calls {
		if strings.HasPrefix(call, prefix) {
			out = append(out, call)
		}
	}
	return out
}

func TestRunsAsListsEveryConnectionWithItsIdentityAndState(t *testing.T) {
	srv, _ := identityServer(t)
	res := run(t, srv, true, "", "connection", "runs-as")
	if res.code != 0 {
		t.Fatalf("exit %d: %s", res.code, res.err)
	}
	for _, want := range []string{"prod", "personal", "alice", "ready", "Archive", "pending_grant"} {
		if !strings.Contains(res.out, want) {
			t.Fatalf("missing %q in:\n%s", want, res.out)
		}
	}
}

func TestRunsAsOneConnectionAlsoFindsOneTheCallerIsNotAdmittedToYet(t *testing.T) {
	srv, calls := identityServer(t)
	// "Archive" is not among the connections the token can use: the link there still waits.
	res := run(t, srv, false, "", "connection", "runs-as", "archive", "-o", "json")
	if res.code != 0 || !strings.Contains(res.out, "Your link is waiting.") {
		t.Fatalf("exit %d out %q err %q", res.code, res.out, res.err)
	}
	if got := sent(calls, "GET /api/rbac/connections/my"); len(got) != 0 {
		t.Fatalf("resolved the name through the connections the token can use: %v", got)
	}
	if miss := run(t, srv, false, "", "connection", "runs-as", "nope"); miss.code != 2 {
		t.Fatalf("an unknown connection must be a usage error, got exit %d", miss.code)
	}
}

func TestIdentityGetAndRecheck(t *testing.T) {
	srv, calls := identityServer(t)
	if res := run(t, srv, false, "", "connection", "identity", "get", "prod"); res.code != 0 || !strings.Contains(res.out, "svc_personal") || !strings.Contains(res.out, "26.3.63.123") {
		t.Fatalf("get: exit %d out %q err %q", res.code, res.out, res.err)
	}
	res := run(t, srv, false, "", "connection", "identity", "recheck", "prod")
	if res.code != 0 || !strings.Contains(res.err, "action=connection.identity_recheck") {
		t.Fatalf("recheck: exit %d err %q", res.code, res.err)
	}
	if got := sent(calls, "POST /api/rbac/connections/"+prodID+"/identity/recheck"); len(got) != 1 {
		t.Fatalf("want one recheck, got %v", got)
	}
	if dry := run(t, srv, false, "", "connection", "identity", "recheck", "prod", "--dry-run"); dry.code != 2 {
		t.Fatalf("--dry-run must be refused for a command that always executes, got exit %d", dry.code)
	}
	// A typo is not taken for a connection name.
	if typo := run(t, srv, false, "", "connection", "identity", "rechek", "prod"); typo.code != 2 {
		t.Fatalf("an unknown subcommand must be a usage error, got exit %d", typo.code)
	}
}

func TestLinksListIsATableOfLinksAndEverythingInJSON(t *testing.T) {
	srv, _ := identityServer(t)
	table := run(t, srv, true, "", "connection", "links", "list", "prod")
	if table.code != 0 || !strings.Contains(table.out, "ann.lee") || !strings.Contains(table.out, "pending_grant") || strings.Contains(table.out, "GRANT IMPERSONATE") {
		t.Fatalf("table: exit %d out:\n%s", table.code, table.out)
	}
	raw := run(t, srv, false, "", "connection", "links", "list", "prod", "-o", "json")
	for _, want := range []string{"\"grants\"", "\"unbound\"", "\"readiness\"", "b-ben"} {
		if !strings.Contains(raw.out, want) {
			t.Fatalf("json lacks %s:\n%s", want, raw.out)
		}
	}
}

func TestLinksGrantsPrintsOnlySQLOnStdout(t *testing.T) {
	srv, _ := identityServer(t)
	res := run(t, srv, false, "", "connection", "links", "grants", "prod")
	if res.code != 0 || res.out != "GRANT IMPERSONATE ON alice TO chouse_impersonate;  -- ann.lee\n" {
		t.Fatalf("exit %d out %q", res.code, res.out)
	}
	rev := run(t, srv, false, "", "connection", "links", "grants", "prod", "--revokes")
	if rev.out != "REVOKE IMPERSONATE ON old FROM chouse_impersonate;\n" {
		t.Fatalf("revokes: %q", rev.out)
	}
}

func TestLinksAddResolvesTheAccountExactlyAndNeedsConfirmation(t *testing.T) {
	srv, calls := identityServer(t)
	post := "POST /api/rbac/clickhouse-bindings/connection/" + prodID
	// Piped, without --yes: refused before anything is sent.
	if res := run(t, srv, false, "", "connection", "links", "add", "prod", "--account", "eve.park", "--user", "erin"); res.code != 2 || len(sent(calls, post)) != 0 {
		t.Fatalf("without --yes: exit %d, sent %v", res.code, sent(calls, post))
	}
	res := run(t, srv, false, "", "connection", "links", "add", "prod", "--account", "eve.park", "--user", "erin", "--yes")
	if res.code != 0 || !strings.Contains(res.out, "pending_grant") || !strings.Contains(res.err, "action=binding.created") {
		t.Fatalf("add: exit %d out %q err %q", res.code, res.out, res.err)
	}
	got := sent(calls, post)
	if len(got) != 1 || !strings.Contains(got[0], `"userId":"u-eve"`) || !strings.Contains(got[0], `"clickhouseUser":"erin"`) {
		t.Fatalf("sent %v", got)
	}
	// "park" matches two accounts by substring and none exactly: nothing is linked on a guess.
	if res := run(t, srv, false, "", "connection", "links", "add", "prod", "--account", "park", "--user", "erin", "--yes"); res.code != 2 || len(sent(calls, post)) != 1 {
		t.Fatalf("ambiguous account: exit %d, sent %v", res.code, sent(calls, post))
	}
	if res := run(t, srv, false, "", "connection", "links", "add", "prod", "--user", "erin", "--yes"); res.code != 2 {
		t.Fatalf("missing --account must be a usage error, got %d", res.code)
	}
	// The server's reason is shown as it is.
	refused := run(t, srv, false, "", "connection", "links", "add", "prod", "--account", "eve.park@example.com", "--user", "carol", "--yes")
	if refused.code == 0 || !strings.Contains(refused.err, "There is no ClickHouse user named carol") {
		t.Fatalf("refusal: exit %d err %q", refused.code, refused.err)
	}
}

func TestLinksCheckAndRemoveFindTheLinkByAccount(t *testing.T) {
	srv, calls := identityServer(t)
	checked := run(t, srv, false, "", "connection", "links", "check", "prod", "ann.lee")
	if checked.code != 0 || !strings.Contains(checked.out, "active") {
		t.Fatalf("check: exit %d out %q err %q", checked.code, checked.out, checked.err)
	}
	if res := run(t, srv, false, "", "connection", "links", "remove", "prod", "ben.ortiz@example.com"); res.code != 2 || len(sent(calls, "DELETE")) != 0 {
		t.Fatalf("remove without --yes: exit %d, sent %v", res.code, sent(calls, "DELETE"))
	}
	removed := run(t, srv, false, "", "connection", "links", "remove", "prod", "ben.ortiz@example.com", "--yes")
	if removed.code != 0 || !strings.Contains(removed.err, "action=binding.removed") {
		t.Fatalf("remove: exit %d err %q", removed.code, removed.err)
	}
	if got := sent(calls, "DELETE /api/rbac/clickhouse-bindings/b-ben"); len(got) != 1 {
		t.Fatalf("want one delete of ben's link, got %v", sent(calls, "DELETE"))
	}
	if res := run(t, srv, false, "", "connection", "links", "remove", "prod", "nobody", "--yes"); res.code != 2 {
		t.Fatalf("a link that is not there must be a usage error, got %d", res.code)
	}
	// There is no confirm command: lifting a suspension stays in the UI.
	if res := run(t, srv, false, "", "connection", "links", "confirm", "prod", "ann.lee"); res.code != 2 {
		t.Fatalf("links confirm must not exist, got exit %d", res.code)
	}
}

const (
	draftID = "22222222-2222-4222-8222-222222222222"
	eveID   = "33333333-3333-4333-8333-333333333333"
)

func TestRunsAsRefusesANameTwoConnectionsShare(t *testing.T) {
	srv, _ := identityServer(t)
	res := run(t, srv, false, "", "connection", "runs-as", "twin")
	if res.code != 2 || !strings.Contains(res.err, "2 connections are named") {
		t.Fatalf("exit %d err %q", res.code, res.err)
	}
	if byID := run(t, srv, false, "", "connection", "runs-as", "c-twin-2", "-o", "json"); byID.code != 0 || !strings.Contains(byID.out, "c-twin-2") {
		t.Fatalf("by id: exit %d out %q", byID.code, byID.out)
	}
}

func TestIdentityRecheckExitsNonZeroWhenTheLoginFails(t *testing.T) {
	srv, _ := identityServer(t)
	res := run(t, srv, false, "", "connection", "identity", "recheck", "draft", "-o", "json")
	if res.code != 5 || !strings.Contains(res.out, "direct grant") || !strings.Contains(res.err, "failed its checks") {
		t.Fatalf("exit %d out %q err %q", res.code, res.out, res.err)
	}
}

func TestLinksGrantsRefusesAPlaceholderScript(t *testing.T) {
	srv, _ := identityServer(t)
	res := run(t, srv, false, "", "connection", "links", "grants", "draft")
	if res.code != 2 || res.out != "" || !strings.Contains(res.err, "no impersonation role") {
		t.Fatalf("exit %d out %q err %q", res.code, res.out, res.err)
	}
}

func TestLinksAddFindsAnAccountByItsID(t *testing.T) {
	srv, calls := identityServer(t)
	res := run(t, srv, false, "", "connection", "links", "add", "prod", "--account", eveID, "--user", "erin", "--yes")
	if res.code != 0 {
		t.Fatalf("exit %d err %q", res.code, res.err)
	}
	if got := sent(calls, "POST /api/rbac/clickhouse-bindings/connection/"+prodID); len(got) != 1 || !strings.Contains(got[0], eveID) {
		t.Fatalf("want one link for the account id, got %v", got)
	}
}
