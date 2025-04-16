function main(text, user)
    if not user or string.lower(user) ~= "pixyroux" then
        return "Sorry, You are not pixyroux!!"
    end

    stream_alert({
        audioUrl = 'https://streamlabs.local.woofx3.tv/beautiful-things.mp3',
    })
end