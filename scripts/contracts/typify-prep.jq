# Turns an OpenAPI document into the input typify wants: components.schemas as definitions, local refs rewritten,
# members of a oneOf inlined (typify only emits a serde-tagged enum for inline variants), and the keywords it panics on
# or ignores (if/then/else, discriminator) removed.
.components.schemas as $defs
| def inl: if type == "object" then
    (if has("oneOf") then .oneOf |= map(if has("$ref") then $defs[(."$ref" | split("/") | last)] else . end) else . end)
    | map_values(inl)
  elif type == "array" then map(inl) else . end;
{definitions: ($defs | map_values(inl))}
| walk(if type == "object" then
    del(.if, .then, .else, .discriminator)
    | (if has("allOf") then .allOf |= map(select((keys - ["description"]) | length > 0)) | (if (.allOf | length) == 0 then del(.allOf) else . end) else . end)
  else . end)
