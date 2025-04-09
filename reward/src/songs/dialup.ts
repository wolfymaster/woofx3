const clips = [
    "https://streamlabs.local.woofx3.tv/internet/internet_000.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_001.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_002.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_003.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_004.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_005.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_006.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_007.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_008.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_009.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_010.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_011.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_012.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_013.mp3",
    "https://streamlabs.local.woofx3.tv/internet/internet_014.mp3",
];

export default function* Dialup() {
    let idx = 0;

    while(true) {
        yield {
            audioUrl: clips[idx],
        }

        idx = (idx + 1) % clips.length;
    }
}