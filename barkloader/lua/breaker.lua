function main(text, user)
    if not user or string.lower(user) ~= "Breaker_Dev" then
        return "Sorry, You are not the greatest person alive!!"
    end

    stream_alert({
        audioUrl = 'https://www.youtube.com/watch?v=2D-ZO2rGcSA',
    })
end