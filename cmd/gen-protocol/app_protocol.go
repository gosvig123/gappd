package main

import (
	"fmt"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"reflect"
	"strings"
)

func renderAppProtocol() string {
	var b strings.Builder
	b.WriteString(protocolHeader)
	b.WriteString(appProtocolImports())
	writeMapType(&b, "AppCommandInput", inputTypeName)
	writeMapType(&b, "AppCommandOutput", outputTypeName)
	writeCommandHelpers(&b)
	writeCommandMap(&b)
	writeCommandTypes(&b)
	return b.String()
}

func appProtocolImports() string {
	types := appProtocolTypeNames()
	return fmt.Sprintf("\nimport type { %s } from './contracts'\nimport type { RecordingProtocolEventType } from './protocol'\n", strings.Join(types, ", "))
}

func appProtocolTypeNames() []string {
	seen := map[string]bool{}
	for _, command := range appprotocol.Commands {
		addTypeName(seen, inputTypeName(command))
		addTypeName(seen, outputTypeName(command))
		addTypeName(seen, eventTypeName(command))
	}
	return sortedKeys(seen)
}

func addTypeName(seen map[string]bool, name string) {
	if name != "" {
		seen[name] = true
	}
}

func writeCommandHelpers(b *strings.Builder) {
	b.WriteString(`
type CommandDefinition<Input> = {
  mode: 'request' | 'stream'
  args(input: Input): string[]
  env: readonly string[]
  terminal: readonly RecordingProtocolEventType[]
}

type AppCommandDefinitions = { [K in keyof AppCommandInput]: CommandDefinition<AppCommandInput[K]> }
`)
}

func writeCommandMap(b *strings.Builder) {
	b.WriteString("\nexport const APP_COMMANDS = {\n")
	for _, command := range appprotocol.Commands {
		parameter := "_input"
		for _, arg := range command.Args {
			if arg.Field != "" {
				parameter = "input"
				break
			}
		}
		fmt.Fprintf(b, "  %s: { mode: %s, args: (%s: %s) => %s, env: %s, terminal: %s },\n", quote(command.ID), quote(string(command.Mode)), parameter, inputTypeName(command), argsExpr(command.Input, command.Args), stringList(command.Env), eventList(command.Terminal))
	}
	b.WriteString("} as const satisfies AppCommandDefinitions\n")
}

func writeCommandTypes(b *strings.Builder) {
	b.WriteString("\nexport type AppCommandID = keyof typeof APP_COMMANDS\n")
	b.WriteString("export type AppRequestID = keyof AppCommandOutput\n")
	b.WriteString("export type AppStreamID = { [K in AppCommandID]: AppCommandMode<K> extends 'stream' ? K : never }[AppCommandID]\n")
	b.WriteString("export type AppCommandMode<ID extends AppCommandID> = (typeof APP_COMMANDS)[ID]['mode']\n")
	writeStreamEventType(b)
}

func writeStreamEventType(b *strings.Builder) {
	b.WriteString("export type AppStreamEvent<ID extends AppStreamID> = {\n")
	for _, command := range appprotocol.StreamCommands() {
		fmt.Fprintf(b, "  %s: %s\n", quote(command.ID), eventTypeName(command))
	}
	b.WriteString("}[ID]\n")
}

func writeMapType(b *strings.Builder, name string, value func(appprotocol.CommandSpec) string) {
	b.WriteString("\nexport type " + name + " = {\n")
	for _, command := range appprotocol.Commands {
		if typeName := value(command); typeName != "" {
			fmt.Fprintf(b, "  %s: %s\n", quote(command.ID), typeName)
		}
	}
	b.WriteString("}\n")
}

func argsExpr(input reflect.Type, args []appprotocol.CommandArg) string {
	parts := make([]string, 0, len(args))
	for _, arg := range args {
		parts = append(parts, argExpr(input, arg))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func argExpr(input reflect.Type, arg appprotocol.CommandArg) string {
	if arg.Literal != "" {
		return quote(arg.Literal)
	}
	if arg.Flag == "" {
		return fieldExpr(arg)
	}
	if arg.Optional {
		return optionalFlagExpr(input, arg)
	}
	return quote("--"+arg.Flag) + ", " + fieldExpr(arg)
}

func optionalFlagExpr(input reflect.Type, arg appprotocol.CommandArg) string {
	if commandFieldType(input, arg.Field).Kind() == reflect.Bool {
		return fmt.Sprintf("...(input.%s === undefined ? [] : [%s + String(input.%s)])", arg.Field, quote("--"+arg.Flag+"="), arg.Field)
	}
	return fmt.Sprintf("...(input.%s === undefined ? [] : [%s, %s])", arg.Field, quote("--"+arg.Flag), fieldExpr(arg))
}

func commandFieldType(input reflect.Type, jsonField string) reflect.Type {
	input = deref(input)
	for i := 0; i < input.NumField(); i++ {
		field := input.Field(i)
		name, _ := jsonName(field)
		if name == jsonField {
			return deref(field.Type)
		}
	}
	panic(fmt.Sprintf("protocol input %s has no JSON field %q", input.Name(), jsonField))
}

func fieldExpr(arg appprotocol.CommandArg) string {
	return "String(input." + arg.Field + ")"
}

func inputTypeName(command appprotocol.CommandSpec) string {
	return command.Input.Name()
}

func outputTypeName(command appprotocol.CommandSpec) string {
	if command.Output == nil {
		return ""
	}
	return command.Output.Name()
}

func eventTypeName(command appprotocol.CommandSpec) string {
	if command.Event == nil {
		return ""
	}
	return command.Event.Name()
}
