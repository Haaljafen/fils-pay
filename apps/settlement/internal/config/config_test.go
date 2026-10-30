package config

import "testing"

func withEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

func TestLoad_DatabaseURLRequired(t *testing.T) {
	withEnv(t, map[string]string{"DATABASE_URL": ""})
	if _, err := Load(); err == nil {
		t.Fatal("expected an error when DATABASE_URL is unset")
	}
}

func TestLoad_UsesDatabaseURLByDefault(t *testing.T) {
	withEnv(t, map[string]string{"DATABASE_URL": "postgres://a/db", "PGCONN_SETTLEMENT": ""})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DatabaseURL != "postgres://a/db" {
		t.Fatalf("expected DatabaseURL to be DATABASE_URL's value, got %q", cfg.DatabaseURL)
	}
}

// The documented rule (ops/README.md, compose): PGCONN_SETTLEMENT only takes
// effect when DATABASE_URL is unset. This test used to assert the opposite and so
// froze the bug that let a stray PGCONN_SETTLEMENT redirect the money-writing
// worker to another database.
func TestLoad_DatabaseURLWinsOverPgconnSettlement(t *testing.T) {
	withEnv(t, map[string]string{
		"DATABASE_URL":      "postgres://a/db",
		"PGCONN_SETTLEMENT": "postgres://b/settlement-replica",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DatabaseURL != "postgres://a/db" {
		t.Fatalf("expected DATABASE_URL to win, got %q", cfg.DatabaseURL)
	}
}

func TestLoad_PgconnSettlementIsTheFallbackWhenDatabaseURLIsUnset(t *testing.T) {
	withEnv(t, map[string]string{
		"DATABASE_URL":      "",
		"PGCONN_SETTLEMENT": "postgres://b/settlement",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DatabaseURL != "postgres://b/settlement" {
		t.Fatalf("expected the fallback, got %q", cfg.DatabaseURL)
	}
}
