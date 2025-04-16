Govee = {
    baseURL = 'https://openapi.api.govee.com/router/api/v1',
    deviceSku = 'H619Z',
    deviceId = 'E3:2F:60:74:F4:C0:8B:08',
    ORIGINAL_RED_COLOR = 16711680,
    colorMap = {
        -- Basic colors
        black = {0, 0, 0},
        white = {255, 255, 255},
        red = {255, 0, 0},
        green = {0, 255, 0},
        blue = {0, 0, 255},
        yellow = {255, 255, 0},
        cyan = {0, 255, 255},
        magenta = {255, 0, 255},
        
        -- Gray shades
        gray = {128, 128, 128},
        silver = {192, 192, 192},
        darkgray = {169, 169, 169},
        lightgray = {211, 211, 211},
        
        -- Red variations
        darkred = {139, 0, 0},
        salmon = {250, 128, 114},
        coral = {255, 127, 80},
        crimson = {220, 20, 60},
        firebrick = {178, 34, 34},
        indianred = {205, 92, 92},
        lightcoral = {240, 128, 128},
        maroon = {128, 0, 0},
        ruby = {144, 12, 6},
        
        -- Green variations
        darkgreen = {0, 100, 0},
        forestgreen = {34, 139, 34},
        limegreen = {50, 205, 50},
        lightgreen = {144, 238, 144},
        palegreen = {152, 251, 152},
        seagreen = {46, 139, 87},
        olive = {128, 128, 0},
        diarrheagreen = {63, 110, 46},

        -- Blue variations
        navy = {0, 0, 128},
        darkblue = {0, 0, 139},
        royalblue = {65, 105, 225},
        steelblue = {70, 130, 180},
        skyblue = {135, 206, 235},
        lightblue = {173, 216, 230},
        powderblue = {176, 224, 230},
        
        -- Purple/Pink variations
        purple = {128, 0, 128},
        indigo = {75, 0, 130},
        violet = {238, 130, 238},
        periwinkle = {204, 204, 255},
        orchid = {218, 112, 214},
        plum = {221, 160, 221},
        pink = {255, 192, 203},
        hotpink = {255, 105, 180},
        deeppink = {255, 20, 147},
        
        -- Brown variations
        brown = {165, 42, 42},
        chocolate = {210, 105, 30},
        saddlebrown = {139, 69, 19},
        sandybrown = {244, 164, 96},
        peru = {205, 133, 63},
        sienna = {160, 82, 45},
        tan = {210, 180, 140},
        
        -- Orange variations
        orange = {255, 165, 0},
        darkorange = {255, 140, 0},
        tomato = {255, 99, 71},
        
        -- Other colors
        gold = {255, 215, 0},
        khaki = {240, 230, 140},
        turquoise = {64, 224, 208},
        teal = {0, 128, 128},
        beige = {245, 245, 220},
        ivory = {255, 255, 240},
        wheat = {245, 222, 179}
    }
}

-- Constructor
function Govee.new()
    local self = {}
    setmetatable(self, { __index = Govee })
    return self
end

-- Set color method
function Govee:setColor(r, g, b)
    local color = self:rgbToColor(r, g, b)
    local request = self:colorSettingRequest(color)
    return self:makeRequest(self.baseURL .. '/device/control', 'post', request)
end

-- Reset method
function Govee:reset()
    local request = self:colorSettingRequest(self.ORIGINAL_RED_COLOR)
    return self:makeRequest(self.baseURL .. '/device/control', 'post', request)
end

-- Lookup color method
function Govee:lookupColor(color)
    local key = color:lower():gsub('^%s*(.-)%s*$', '%1')
    return self.colorMap[key]
end

-- Helper methods
function Govee:rgbToColor(r, g, b)
    return (r & 0xFF) << 16 | (g & 0xFF) << 8 | (b & 0xFF)
end

function Govee:colorSettingRequest(value)
    return {
        requestId = "not-used",
        payload = {
            sku = self.deviceSku,
            device = self.deviceId,
            capability = {
                type = "devices.capabilities.color_setting",
                instance = "colorRgb",
                value = value
            }
        }
    }
end

function Govee:makeRequest(url, method, body)
    local headers = {
        ['Govee-API-Key'] = environment('GOVEE_API_KEY') or '',
        ['Content-Type'] = 'application/json'
    }
    
    return httpRequest(url, method, {
        body = body,
        headers = headers
    })
end

-- Main function to handle commands
function main(text)
    local govee = Govee.new()
    
    -- check for reset
    if text == 'reset' then
        local x = govee:reset()
        return x
    end
    
    -- parse text for rgb values
    if text:find(',') then
        local rgb = {}
        for value in text:gmatch('([^,]+)') do
            table.insert(rgb, tonumber(value:match('^%s*(.-)%s*$')))
        end
        if #rgb == 3 then
            govee:setColor(rgb[1], rgb[2], rgb[3])
            return ''
        end
    end
    
    -- lookup color if given color name
    local rgb = govee:lookupColor(text)
    
    if rgb then
        govee:setColor(rgb[1], rgb[2], rgb[3])
    end
end