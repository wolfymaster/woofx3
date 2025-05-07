function main(args)
    return { response = "Hello " .. (args.name or "World") }
end
