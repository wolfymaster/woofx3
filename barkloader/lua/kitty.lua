function main(text, user)
    if not user or string.lower(user) ~= "kittyclemente" then
        return "Sorry, You are not kitty!!"
    end

    stream_alert({
        audioUrl = 'https://streamlabs.local.woofx3.tv/goodkittykitty.mp3',
    })
end