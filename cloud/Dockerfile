FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /server ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -o /admin ./cmd/admin
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /server /server
COPY --from=build /admin /admin
EXPOSE 8080
ENTRYPOINT ["/server"]
