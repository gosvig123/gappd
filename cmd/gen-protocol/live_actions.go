package main

import (
	"path/filepath"
	"reflect"
	"strings"
)

func isLiveActionType(typ reflect.Type) bool {
	switch typ.Name() {
	case "LiveActionDraft", "LiveActionItem", "LiveActionsResponse":
		return true
	default:
		return false
	}
}

func renderLiveActionContracts() string {
	var b strings.Builder
	b.WriteString(protocolHeader)
	for _, typ := range collectCommandTypes().order {
		if isLiveActionType(typ) {
			writeType(&b, typ)
		}
	}
	return b.String()
}

func liveActionContractsPath(contractsPath string) string {
	return filepath.Join(filepath.Dir(contractsPath), "live-actions.ts")
}
