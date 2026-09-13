package ai

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"syscall"

	"github.com/gappd-dev/gappd/internal/processgroup"
)

const (
	codexCatalogPageSize = 50
	codexCatalogMaxPages = 20
	codexCatalogInitID   = 1
	codexCatalogListID   = 2
)

type codexCatalogModel struct {
	ID                        string `json:"id"`
	Model                     string `json:"model"`
	DisplayName               string `json:"displayName"`
	DefaultReasoningEffort    string `json:"defaultReasoningEffort"`
	Hidden                    bool   `json:"hidden"`
	IsDefault                 bool   `json:"isDefault"`
	SupportedReasoningEfforts []struct {
		ReasoningEffort string `json:"reasoningEffort"`
	} `json:"supportedReasoningEfforts"`
}

type codexCatalogPage struct {
	Models     []codexCatalogModel `json:"data"`
	NextCursor *string             `json:"nextCursor"`
}

type codexCatalogMessage struct {
	ID     *json.RawMessage  `json:"id"`
	Result json.RawMessage   `json:"result"`
	Error  *codexCatalogFail `json:"error"`
}

type codexCatalogFail struct {
	Message string `json:"message"`
}

type codexCatalogSession struct {
	cmd  *exec.Cmd
	in   io.WriteCloser
	out  *bufio.Reader
	done chan error
}

func startCodexCatalog(executable string) (*codexCatalogSession, error) {
	cmd := exec.Command(executable, "app-server", "--stdio")
	cmd.Env = codexEnvironment(os.Environ())
	processgroup.Configure(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("open Codex model catalog input: %w", err)
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open Codex model catalog output: %w", err)
	}
	cmd.Stderr = &cappedWriter{remaining: codexCaptureLimit}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start Codex model catalog: %w", err)
	}
	session := &codexCatalogSession{
		cmd:  cmd,
		in:   in,
		out:  bufio.NewReader(io.LimitReader(out, codexCatalogLimit)),
		done: make(chan error, 1),
	}
	go func() { session.done <- cmd.Wait() }()
	return session, nil
}

func (s *codexCatalogSession) close() {
	_ = s.in.Close()
	_ = processgroup.Signal(s.cmd, syscall.SIGTERM)
	if !waitForProcess(s.done, codexKillGrace) {
		_ = processgroup.Signal(s.cmd, syscall.SIGKILL)
		_ = waitForProcess(s.done, codexKillGrace)
	}
}

func (s *codexCatalogSession) readModels() ([]CodexModel, error) {
	init := map[string]any{"clientInfo": map[string]any{"name": "gappd", "version": "1"}}
	// Both the write and the read name the same step, so the reported failure does not depend
	// on whether a broken child is noticed while writing or while reading.
	if err := s.send(codexCatalogInitID, "initialize", init); err != nil {
		return nil, fmt.Errorf("initialize Codex model catalog: %w", err)
	}
	if _, err := s.await(codexCatalogInitID); err != nil {
		return nil, fmt.Errorf("initialize Codex model catalog: %w", err)
	}
	cursor := ""
	models := []CodexModel(nil)
	for page := 0; page < codexCatalogMaxPages; page++ {
		next, err := s.readPage(cursor)
		if err != nil {
			return nil, err
		}
		models = append(models, convertCodexModels(next.Models)...)
		if next.NextCursor == nil || *next.NextCursor == "" {
			return models, nil
		}
		cursor = *next.NextCursor
	}
	return nil, fmt.Errorf("Codex model catalog returned more than %d pages", codexCatalogMaxPages)
}

func (s *codexCatalogSession) readPage(cursor string) (codexCatalogPage, error) {
	params := map[string]any{"includeHidden": false, "limit": codexCatalogPageSize}
	if cursor != "" {
		params["cursor"] = cursor
	}
	if err := s.send(codexCatalogListID, "model/list", params); err != nil {
		return codexCatalogPage{}, fmt.Errorf("read Codex model catalog: %w", err)
	}
	result, err := s.await(codexCatalogListID)
	if err != nil {
		return codexCatalogPage{}, fmt.Errorf("read Codex model catalog: %w", err)
	}
	var page codexCatalogPage
	if err := json.Unmarshal(result, &page); err != nil {
		return codexCatalogPage{}, fmt.Errorf("decode Codex model catalog: %w", err)
	}
	return page, nil
}

func (s *codexCatalogSession) send(id int, method string, params any) error {
	payload, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err != nil {
		return fmt.Errorf("encode Codex model catalog request: %w", err)
	}
	if _, err := s.in.Write(append(payload, '\n')); err != nil {
		return fmt.Errorf("write Codex model catalog request: %w", err)
	}
	return nil
}

func (s *codexCatalogSession) await(id int) (json.RawMessage, error) {
	for {
		line, err := s.out.ReadBytes('\n')
		if err != nil {
			return nil, fmt.Errorf("Codex model catalog ended: %w", err)
		}
		var message codexCatalogMessage
		if err := json.Unmarshal(line, &message); err != nil || message.ID == nil {
			continue
		}
		if !codexCatalogIDMatches(*message.ID, id) {
			continue
		}
		if message.Error != nil {
			return nil, fmt.Errorf("%s", message.Error.Message)
		}
		return message.Result, nil
	}
}

func codexCatalogIDMatches(raw json.RawMessage, id int) bool {
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return number == float64(id)
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text == strconv.Itoa(id)
	}
	return false
}
