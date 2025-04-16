function main() 
    local sounds = {'woof1', 'woof2'}
    local rng = math.random(1, #sounds)
    
    stream_alert({
        audioUrl = 'https://streamlabs.local.woofx3.tv/' .. sounds[rng] .. '.mp3'
    })

    return 'woofwoof'
end