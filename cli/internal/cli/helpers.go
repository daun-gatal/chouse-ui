package cli

import (
	"encoding/json"
	"net/url"
)

func auditQuery(limit int, action, status, user string) url.Values {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", itoa(limit))
	}
	if action != "" {
		q.Set("action", action)
	}
	if status != "" {
		q.Set("status", status)
	}
	if user != "" {
		q.Set("userId", user)
	}
	return q
}

func jsonUnmarshal(raw []byte, v any) error {
	return json.Unmarshal(raw, v)
}
