function main(text, user)
    -- Parse the text to extract command, type, and value
    local command, cmdType, typeValue = parseCommandText(text)
    
    -- Call setCommand with the parsed parameters
    setCommand({
        command = command,
        type = cmdType,
        typeValue = typeValue
    })
end

function parseCommandText(text)
    -- Extract the first word as the command
    local parts = {}
    for word in text:gmatch("%S+") do
        table.insert(parts, word)
    end
    
    if #parts == 0 then
        return nil, nil, nil
    end
    
    local command = parts[1]
    local cmdType = "text"  -- Default type is text
    local typeValue = ""
    
    if #parts == 1 then
        -- Command only, no value
        return command, cmdType, typeValue
    end
    
    -- Check if the second word is a type specifier
    if parts[2] == "text" or parts[2] == "func" or parts[2] == "function" then
        cmdType = parts[2] == "text" and "text" or "func"
        
        if cmdType == "func" or cmdType == "function" then
            -- For function type, the next word is the function name
            if #parts >= 3 then
                typeValue = parts[3]
            end
        else
            -- For text type, the rest of the words form the value
            if #parts >= 3 then
                typeValue = table.concat(parts, " ", 3)
            end
        end
    else
        -- No type specified, assume text and use all remaining words
        typeValue = table.concat(parts, " ", 2)
    end
    
    -- Normalize "function" to "func" if needed
    if cmdType == "function" then
        cmdType = "func"
    end
    
    return command, cmdType, typeValue
end