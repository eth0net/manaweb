# Slim rather than alpine: musl's allocator is the wrong trade for anything
# threaded. Pinned to the version `rust-version` names, so a bumped MSRV
# cannot pass every cargo job and fail only the image.
FROM rust:1.98-slim-trixie AS build
WORKDIR /src
COPY . .
# Cache mounts rather than cargo-chef: BuildKit is already here and this needs
# no extra tool. The copy is in the same layer, a cache mount being gone by
# the next one.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p manaweb-appview \
    && cp target/release/manaweb /manaweb

FROM debian:trixie-slim
# Scryfall over TLS, and the bucket.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /manaweb /usr/local/bin/manaweb

# A bind mount from the host has to be owned by this id to be writable, which
# `docs/configuration.md` says.
RUN useradd --system --uid 10001 --user-group --no-create-home manaweb \
    && install --directory --owner manaweb --group manaweb --mode 700 /data
VOLUME /data
USER manaweb

# Loopback is the right default for a checkout and useless in a container.
ENV MANAWEB_DATABASE=/data/manaweb.db \
    MANAWEB_CATALOG=/data/catalog \
    MANAWEB_BIND=0.0.0.0:8080
EXPOSE 8080

ENTRYPOINT ["manaweb"]
CMD ["serve"]

LABEL org.opencontainers.image.source=https://github.com/eth0net/manaweb
LABEL org.opencontainers.image.description="An atproto AppView for tracking a Magic: The Gathering collection."
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
