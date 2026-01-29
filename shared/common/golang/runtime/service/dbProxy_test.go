package service

import (
	"testing"
)

func TestDbProxyService(t *testing.T) {
	// Create a new client
	client := NewClient("http://localhost:8080", nil)

	// Create a new db proxy service
	dbProxy := NewDbProxyService(client, true)

	// Test that we can connect (should return nil for now)
	err := dbProxy.Connect()
	if err != nil {
		t.Errorf("Connect() error = %v, want nil", err)
	}

	// Test that we can disconnect (should return nil)
	err = dbProxy.Disconnect()
	if err != nil {
		t.Errorf("Disconnect() error = %v, want nil", err)
	}
}
