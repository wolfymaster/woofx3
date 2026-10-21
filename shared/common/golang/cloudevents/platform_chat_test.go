package cloudevents

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestPlatformChatSendSubject(t *testing.T) {
	if got := PlatformChatSendSubject("twitch"); got != string(SubjectPlatformTwitchChatSend) {
		t.Errorf("PlatformChatSendSubject(twitch) = %q, want %q", got, SubjectPlatformTwitchChatSend)
	}
	if match, reserved := ReservedSubjectMatch(PlatformChatSendSubject("kick")); !reserved || match != PlatformSubjectPrefix {
		t.Errorf("a provider subject must be reserved under %q, got %q, %v", PlatformSubjectPrefix, match, reserved)
	}
}

func TestDecodeChatSendReply(t *testing.T) {
	cases := []struct {
		name string
		body string
		want ChatSendReply
		bad  bool
	}{
		{
			name: "sent line",
			body: `{"ok":true,"messageId":"m-1","isSent":true}`,
			want: ChatSendReply{Sent: &ChatSent{MessageID: "m-1", IsSent: true}},
		},
		{
			name: "announcement without an id",
			body: `{"ok":true,"isSent":true}`,
			want: ChatSendReply{Sent: &ChatSent{IsSent: true}},
		},
		{
			name: "line the platform dropped",
			body: `{"ok":true,"isSent":false,"dropReason":"AutoMod held it"}`,
			want: ChatSendReply{Sent: &ChatSent{IsSent: false, DropReason: "AutoMod held it"}},
		},
		{
			name: "refusal",
			body: `{"ok":false,"error":{"code":"not_linked","message":"Twitch is not linked yet"}}`,
			want: ChatSendReply{Error: &ChatSendError{Code: ChatSendNotLinked, Message: "Twitch is not linked yet"}},
		},
		{name: "not JSON", body: `nope`, bad: true},
		{name: "ok missing", body: `{"isSent":true}`, bad: true},
		{name: "isSent missing", body: `{"ok":true,"messageId":"m-1"}`, bad: true},
		{name: "ok with an error", body: `{"ok":true,"isSent":true,"error":{"code":"invalid","message":"x"}}`, bad: true},
		{name: "failure without an error", body: `{"ok":false}`, bad: true},
		{name: "failure with success fields", body: `{"ok":false,"isSent":false,"error":{"code":"invalid","message":"x"}}`, bad: true},
		{name: "unknown code", body: `{"ok":false,"error":{"code":"teapot","message":"x"}}`, bad: true},
		{name: "empty error message", body: `{"ok":false,"error":{"code":"upstream","message":" "}}`, bad: true},
		{name: "unknown field", body: `{"ok":true,"isSent":true,"extra":1}`, bad: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeChatSendReply([]byte(tc.body))
			if tc.bad {
				if !errors.Is(err, ErrMalformedChatSendReply) {
					t.Fatalf("DecodeChatSendReply(%s) error = %v, want ErrMalformedChatSendReply", tc.body, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("DecodeChatSendReply(%s): %v", tc.body, err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("DecodeChatSendReply(%s) = %+v, want %+v", tc.body, got, tc.want)
			}
		})
	}
}

func TestChatRequestsEncodeByContractNames(t *testing.T) {
	cases := []struct {
		name    string
		request any
		want    string
	}{
		{"send", ChatSendRequest{Message: "hi"}, `{"message":"hi"}`},
		{"reply", ChatSendRequest{Message: "hi", ReplyToMessageID: "m-1"}, `{"message":"hi","replyToMessageId":"m-1"}`},
		{"announce", ChatAnnounceRequest{Message: "hi"}, `{"message":"hi"}`},
		{"announce with color", ChatAnnounceRequest{Message: "hi", Color: AnnouncementColorPurple}, `{"message":"hi","color":"purple"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := json.Marshal(tc.request)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(got) != tc.want {
				t.Errorf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestParseAnnouncementColor(t *testing.T) {
	for _, value := range []string{"primary", "blue", "green", "orange", "purple"} {
		if color, err := ParseAnnouncementColor(value); err != nil || string(color) != value {
			t.Errorf("ParseAnnouncementColor(%q) = %q, %v", value, color, err)
		}
	}
	for _, value := range []string{"", "red", "Blue"} {
		if _, err := ParseAnnouncementColor(value); err == nil {
			t.Errorf("ParseAnnouncementColor(%q) accepted a color Twitch lacks", value)
		}
	}
}
