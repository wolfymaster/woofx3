function main(ctx)
    local name = ctx.event and ctx.event.name or "World"
    return { response = "Hello " .. name }
end
