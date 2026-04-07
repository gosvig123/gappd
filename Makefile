BINARY    := grn
BUILD_DIR := ./build
MODULE    := $(shell grep '^module' go.mod 2>/dev/null | awk '{print $$2}')
VERSION   := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS   := -s -w -X $(MODULE)/internal/version.Version=$(VERSION)
DB_PATH   := ~/.grn/db.sqlite
SCHEMA    := ./internal/db/schema.sql
UNAME_S   := $(shell uname -s)

.PHONY: build build-capture ensure-macos run dev db-init db-reset clean install-capture install

build:
	@mkdir -p $(BUILD_DIR)
	go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY) ./cmd/grn

build-capture: ensure-macos
	@bash capture-helper/build.sh

ensure-macos:
	@if [ "$(UNAME_S)" != "Darwin" ]; then \
		echo "capture-helper targets are only supported on macOS"; \
		exit 1; \
	fi

install-capture: build-capture
	@echo "Installing GrnCapture.app to ~/.grn/..."
	@mkdir -p $(HOME)/.grn
	@rm -rf $(HOME)/.grn/GrnCapture.app
	@cp -R $(BUILD_DIR)/GrnCapture.app $(HOME)/.grn/GrnCapture.app
	@echo "Done. grn-capture installed at ~/.grn/GrnCapture.app"

install: build
	@echo "Installing grn binary to /usr/local/bin/..."
	install -m 755 $(BUILD_DIR)/$(BINARY) /usr/local/bin/$(BINARY)
	@echo "Done. Run: grn"

run: build
	$(BUILD_DIR)/$(BINARY)

dev:
	@which watchexec > /dev/null 2>&1 || { echo "install watchexec: cargo install watchexec-cli"; exit 1; }
	watchexec -r -e go -- go run ./cmd/grn

db-init:
	@mkdir -p ~/.grn
	sqlite3 $(DB_PATH) < $(SCHEMA)
	@echo "database initialised at $(DB_PATH)"

db-reset:
	rm -f $(DB_PATH)
	$(MAKE) db-init

clean:
	rm -rf $(BUILD_DIR)
	go clean -cache -testcache
