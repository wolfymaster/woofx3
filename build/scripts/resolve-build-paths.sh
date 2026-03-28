#!/usr/bin/env bash
# Resolve absolute build output dir from services.json path (…/build/config/services.json → …/build/dist).

woofx3_set_output_dir() {
	local cf="$1"
	cf="$(realpath "$cf")"
	local config_dir build_root rel
	config_dir="$(dirname "$cf")"
	build_root="$(cd "$config_dir/.." && pwd)"
	rel="$(jq -r '.build.output_dir' "$cf")"
	if [[ "$rel" == "null" || -z "$rel" ]]; then
		rel="./dist"
	fi
	OUTPUT_DIR="${build_root}/${rel#./}"
}
