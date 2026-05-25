package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestPluginVersionMatchesPackageJSON guards against drift between the
// User-Agent constant in datasource.go and the npm/build version that is
// shipped in plugin.json. plugin.json itself uses a `%VERSION%` placeholder
// that the build pipeline substitutes from package.json, so package.json is
// the authoritative source.
//
// When this fails: update pluginVersion in datasource.go to match
// package.json (and bump CHANGELOG.md / commit the version bump together).
func TestPluginVersionMatchesPackageJSON(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "package.json"))
	if err != nil {
		t.Fatalf("read package.json: %v", err)
	}
	var pj struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &pj); err != nil {
		t.Fatalf("unmarshal package.json: %v", err)
	}
	if pj.Version == "" {
		t.Fatal("package.json has no version field")
	}
	if pj.Version != pluginVersion {
		t.Fatalf("pluginVersion drift: package.json=%q, pkg/plugin/datasource.go pluginVersion=%q — sync them",
			pj.Version, pluginVersion)
	}
}
