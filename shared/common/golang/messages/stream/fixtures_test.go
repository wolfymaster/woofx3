package stream_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/stream"
)

func TestEventFixtures(t *testing.T) {
	cases := []struct {
		file   string
		schema string
		run    func(t *testing.T, file, schema string)
	}{
		{"user-message.json", "UserMessageEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.UserMessageEvent](t, "stream", file, schema)
		}},
		{"channel-cheer.json", "ChannelCheerEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelCheerEvent](t, "stream", file, schema)
		}},
		{"channel-follow.json", "ChannelFollowEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelFollowEvent](t, "stream", file, schema)
		}},
		{"channel-hypetrain.json", "ChannelHypeTrainEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelHypeTrainEvent](t, "stream", file, schema)
		}},
		{"channel-raid.json", "ChannelRaidEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelRaidEvent](t, "stream", file, schema)
		}},
		{"channelpoints-redeem.json", "ChannelPointsRedeemEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelPointsRedeemEvent](t, "stream", file, schema)
		}},
		{"stream-online.json", "StreamOnlineEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.StreamOnlineEvent](t, "stream", file, schema)
		}},
		{"stream-offline.json", "StreamOfflineEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.StreamOfflineEvent](t, "stream", file, schema)
		}},
		{"channel-subscribe.json", "ChannelSubscribeEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSubscribeEvent](t, "stream", file, schema)
		}},
		{"channel-subscriptionGift.json", "ChannelSubscriptionGiftEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSubscriptionGiftEvent](t, "stream", file, schema)
		}},
		{"channel-resub.json", "ChannelResubEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelResubEvent](t, "stream", file, schema)
		}},
		{"channel-giftPaidUpgrade.json", "ChannelGiftPaidUpgradeEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelGiftPaidUpgradeEvent](t, "stream", file, schema)
		}},
		{"channel-primePaidUpgrade.json", "ChannelPrimePaidUpgradeEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelPrimePaidUpgradeEvent](t, "stream", file, schema)
		}},
		{"channel-unraid.json", "ChannelUnraidEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelUnraidEvent](t, "stream", file, schema)
		}},
		{"channel-payItForward.json", "ChannelPayItForwardEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelPayItForwardEvent](t, "stream", file, schema)
		}},
		{"channel-announcement.json", "ChannelAnnouncementEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelAnnouncementEvent](t, "stream", file, schema)
		}},
		{"channel-charityDonation.json", "ChannelCharityDonationEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelCharityDonationEvent](t, "stream", file, schema)
		}},
		{"channel-bitsBadgeTier.json", "ChannelBitsBadgeTierEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelBitsBadgeTierEvent](t, "stream", file, schema)
		}},
		{"channel-watchStreak.json", "ChannelWatchStreakEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelWatchStreakEvent](t, "stream", file, schema)
		}},
		{"channel-sharedSubscribe.json", "ChannelSharedSubscribeEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedSubscribeEvent](t, "stream", file, schema)
		}},
		{"channel-sharedSubscriptionGift.json", "ChannelSharedSubscriptionGiftEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedSubscriptionGiftEvent](t, "stream", file, schema)
		}},
		{"channel-sharedRaid.json", "ChannelSharedRaidEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedRaidEvent](t, "stream", file, schema)
		}},
		{"channel-sharedResub.json", "ChannelSharedResubEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedResubEvent](t, "stream", file, schema)
		}},
		{"channel-sharedGiftPaidUpgrade.json", "ChannelSharedGiftPaidUpgradeEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedGiftPaidUpgradeEvent](t, "stream", file, schema)
		}},
		{"channel-sharedPrimePaidUpgrade.json", "ChannelSharedPrimePaidUpgradeEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedPrimePaidUpgradeEvent](t, "stream", file, schema)
		}},
		{"channel-sharedPayItForward.json", "ChannelSharedPayItForwardEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedPayItForwardEvent](t, "stream", file, schema)
		}},
		{"channel-sharedAnnouncement.json", "ChannelSharedAnnouncementEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelSharedAnnouncementEvent](t, "stream", file, schema)
		}},
		{"channel-ad-break-upcoming.json", "ChannelAdBreakUpcomingEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelAdBreakUpcomingEvent](t, "stream", file, schema)
		}},
		{"channel-ad-break-begin.json", "ChannelAdBreakBeginEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelAdBreakBeginEvent](t, "stream", file, schema)
		}},
		{"channel-ad-break-end.json", "ChannelAdBreakEndEvent", func(t *testing.T, file, schema string) {
			fixturetest.Run[stream.ChannelAdBreakEndEvent](t, "stream", file, schema)
		}},
	}
	for _, c := range cases {
		t.Run(c.schema, func(t *testing.T) { c.run(t, c.file, c.schema) })
	}
}
