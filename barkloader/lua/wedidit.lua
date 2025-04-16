function main(text, user)
    stream_alert({
        audioUrl = 'https://streamlabs.local.woofx3.tv/wedidit.mp3',
        mediaUrl = 'https://streamlabs.local.woofx3.tv/confetti.gif',
        duration = 10,
        options = {
            view = {
                fullScreen = true,
            }
        }
    })

    return 'WE DID IT!'
end