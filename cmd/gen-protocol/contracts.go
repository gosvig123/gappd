package main

import (
	"fmt"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/gappd-dev/gappd/internal/recording"
	"reflect"
	"strings"
)

type typeCollector struct {
	seen  map[reflect.Type]bool
	order []reflect.Type
}

func renderContracts() string {
	collector := collectCommandTypes()
	var b strings.Builder
	b.WriteString(protocolHeader)
	b.WriteString("\nimport type { CaptureStatus, DiarizationState, MeetingState, ProcessingCapability, ProcessingStatus, RecordingProtocolEventType } from './protocol'\n")
	for _, typ := range collector.order {
		writeType(&b, typ)
	}
	return b.String()
}

func collectCommandTypes() typeCollector {
	collector := typeCollector{seen: map[reflect.Type]bool{}}
	for _, command := range appprotocol.Commands {
		collector.add(command.Input)
		collector.add(command.Output)
		collector.add(command.Event)
	}
	return collector
}

func (c *typeCollector) add(typ reflect.Type) {
	if typ == nil {
		return
	}
	typ = deref(typ)
	if !isStructFromAppProtocol(typ) || c.seen[typ] {
		return
	}
	c.seen[typ] = true
	c.order = append(c.order, typ)
	for i := 0; i < typ.NumField(); i++ {
		c.add(typ.Field(i).Type)
	}
}

func isStructFromAppProtocol(typ reflect.Type) bool {
	return typ.Kind() == reflect.Struct && typ.PkgPath() == "github.com/gappd-dev/gappd/internal/appprotocol"
}

func writeType(b *strings.Builder, typ reflect.Type) {
	if typ.NumField() == 0 {
		fmt.Fprintf(b, "\nexport type %s = Record<string, never>\n", typ.Name())
		return
	}
	fmt.Fprintf(b, "\nexport type %s = {\n", typ.Name())
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if !field.IsExported() {
			continue
		}
		name, optional := jsonName(field)
		fmt.Fprintf(b, "  %s%s: %s\n", name, optionalMark(optional), tsType(field.Type))
	}
	b.WriteString("}")
	if typ.Name() != "MeetingDetail" && typ.Name() != "MeetingResponse" {
		b.WriteString("\n")
	}
}

func jsonName(field reflect.StructField) (string, bool) {
	tag := field.Tag.Get("json")
	parts := strings.Split(tag, ",")
	if parts[0] == "" {
		parts[0] = field.Name
	}
	return parts[0], contains(parts[1:], "omitempty") || field.Type.Kind() == reflect.Pointer
}

func optionalMark(optional bool) string {
	if optional {
		return "?"
	}
	return ""
}

func tsType(typ reflect.Type) string {
	if typ.Kind() == reflect.Pointer {
		return tsType(typ.Elem())
	}
	if enumName := enumTypeName(typ); enumName != "" {
		return enumName
	}
	return baseTSType(typ)
}

func baseTSType(typ reflect.Type) string {
	switch typ.Kind() {
	case reflect.String:
		return "string"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Float32, reflect.Float64:
		return "number"
	case reflect.Bool:
		return "boolean"
	case reflect.Slice, reflect.Array:
		return tsType(typ.Elem()) + "[]"
	case reflect.Struct:
		return typ.Name()
	default:
		return "unknown"
	}
}

func enumTypeName(typ reflect.Type) string {
	switch typ {
	case reflect.TypeOf(db.CaptureStatus("")):
		return "CaptureStatus"
	case reflect.TypeOf(db.ProcessingStatus("")):
		return "ProcessingStatus"
	case reflect.TypeOf(db.DiarizationState("")):
		return "DiarizationState"
	case reflect.TypeOf(meetinglifecycle.MeetingState("")):
		return "MeetingState"
	case reflect.TypeOf(meetingprocessing.Capability("")):
		return "ProcessingCapability"
	case reflect.TypeOf(recording.EventName("")):
		return "RecordingProtocolEventType"
	default:
		return ""
	}
}
