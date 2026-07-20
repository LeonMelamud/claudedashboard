#!/usr/bin/env bash
# =============================================================================
# build-offline-bundle.sh — produce an air-gapped install bundle for
# Claude Code Insights (container image + Helm chart + install docs).
#
# Usage:   scripts/build-offline-bundle.sh [version]
#          version defaults to "version" in the root package.json.
#
# Output:  dist/offline-bundle-<version>/
#            claude-code-insights-<version>-linux-amd64.tar.gz  (docker image)
#            claude-code-insights-<version>.tgz                 (helm chart)
#            values-example.yaml                                (prod starter)
#            INSTALL-OFFLINE.md
#            sha256sums.txt
#          dist/offline-bundle-<version>.tar.gz                 (the lot)
#
# Requires: docker (with buildx), helm, gzip, shasum or sha256sum.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="$REPO_ROOT/deploy/helm/claude-code-insights"
IMAGE_NAME="claude-code-insights"

# --- version: arg 1, else package.json "version" -----------------------------
if [[ $# -ge 1 && -n "${1:-}" ]]; then
  VERSION="$1"
else
  VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
fi
echo "==> Building offline bundle for version $VERSION"

BUNDLE_DIR="$REPO_ROOT/dist/offline-bundle-$VERSION"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# --- 1. Build the linux/amd64 image ------------------------------------------
# --platform linux/amd64 is MANDATORY: dev machines here are Apple Silicon
# (arm64) while AKS node pools are amd64 — without the flag you'd ship an
# arm64 image that crash-loops with "exec format error" on the cluster.
# --load exports the (single-platform) result into the local docker engine
# so `docker save` can read it.
echo "==> docker buildx build (linux/amd64 — cross-build from this machine)"
docker buildx build \
  --platform linux/amd64 \
  -t "$IMAGE_NAME:$VERSION" \
  --load \
  "$REPO_ROOT"

# --- 2. Save + gzip the image -------------------------------------------------
IMAGE_TAR="$BUNDLE_DIR/$IMAGE_NAME-$VERSION-linux-amd64.tar.gz"
echo "==> docker save -> $IMAGE_TAR"
docker save "$IMAGE_NAME:$VERSION" | gzip > "$IMAGE_TAR"

# --- 3. Package the Helm chart ------------------------------------------------
echo "==> helm package $CHART_DIR"
helm package "$CHART_DIR" --destination "$BUNDLE_DIR" >/dev/null
CHART_TGZ="$(ls "$BUNDLE_DIR"/claude-code-insights-*.tgz)"
echo "    -> $CHART_TGZ"

# --- 4. Example production values ---------------------------------------------
cat > "$BUNDLE_DIR/values-example.yaml" <<EOF
# Minimal production values for an air-gapped AKS install.
# Full documentation of every knob: values.yaml inside the chart.
image:
  # The registry you pushed the loaded image into (step 2 of INSTALL-OFFLINE.md).
  repository: myregistry.azurecr.io/claude-code-insights
  tag: "$VERSION"

dataSource: telemetry
privacyMode: balanced

secrets:
  # Recommended: create the secret out-of-band and reference it here
  # (keys: otel-ingest-token, admin-api-key, enterprise-analytics-key).
  existingSecret: ""
  # ...or inline (lands in Helm release history — fine for a token,
  # avoid for API keys):
  otelIngestToken: ""

persistence:
  size: 8Gi
  storageClassName: managed-csi

# Internal Azure Load Balancer so dev machines on the VNet can push
# telemetry. The dashboard has no auth — do NOT use a public LB.
service:
  type: LoadBalancer
  port: 80
  annotations:
    service.beta.kubernetes.io/azure-load-balancer-internal: "true"
EOF

# --- 5. Offline install instructions -------------------------------------------
cat > "$BUNDLE_DIR/INSTALL-OFFLINE.md" <<EOF
# Claude Code Insights $VERSION — offline (air-gapped) install

Bundle contents:

| File | What |
| --- | --- |
| \`$IMAGE_NAME-$VERSION-linux-amd64.tar.gz\` | container image (linux/amd64) |
| \`$(basename "$CHART_TGZ")\` | Helm chart |
| \`values-example.yaml\` | starter production values |
| \`sha256sums.txt\` | checksums for the above |

## 1. Transfer & verify

Copy the bundle to a machine that can reach the private registry and the
cluster, then:

\`\`\`bash
shasum -a 256 -c sha256sums.txt   # or: sha256sum -c sha256sums.txt
\`\`\`

## 2. Push the image into the private registry

Pick one:

\`\`\`bash
# a) docker load + retag + push (needs a docker daemon + registry login)
docker load < $IMAGE_NAME-$VERSION-linux-amd64.tar.gz
docker tag $IMAGE_NAME:$VERSION <registry>/claude-code-insights:$VERSION
docker push <registry>/claude-code-insights:$VERSION

# b) crane — no docker daemon needed
crane push $IMAGE_NAME-$VERSION-linux-amd64.tar.gz <registry>/claude-code-insights:$VERSION

# c) ACR with outbound access to a staging registry
az acr import --name <acrName> --source <staging>/claude-code-insights:$VERSION
\`\`\`

## 3. Install the chart

\`\`\`bash
cp values-example.yaml values-prod.yaml   # edit: registry, token/secret, exposure

helm install insights $(basename "$CHART_TGZ") \\
  --namespace claude-insights --create-namespace \\
  -f values-prod.yaml \\
  --set image.repository=<registry>/claude-code-insights
\`\`\`

Post-install steps (telemetry endpoint for dev machines, verification,
backups) are in \`docs/deploy-aks.md\` in the repo; the release NOTES printed
by \`helm install\` cover the essentials.
EOF

# --- 6. Checksums ---------------------------------------------------------------
echo "==> sha256sums.txt"
(
  cd "$BUNDLE_DIR"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 ./*.tar.gz ./*.tgz values-example.yaml > sha256sums.txt
  else
    sha256sum ./*.tar.gz ./*.tgz values-example.yaml > sha256sums.txt
  fi
)

# --- 7. Final single-file bundle --------------------------------------------------
FINAL_TAR="$REPO_ROOT/dist/offline-bundle-$VERSION.tar.gz"
echo "==> $FINAL_TAR"
tar -czf "$FINAL_TAR" -C "$REPO_ROOT/dist" "offline-bundle-$VERSION"

echo
echo "Done."
echo "  bundle dir : $BUNDLE_DIR"
echo "  single file: $FINAL_TAR"
