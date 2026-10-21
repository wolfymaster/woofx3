package cloudevents

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// The chat provider contract: how the engine asks a platform's service to say
// something in that platform's chat. Request/reply over the bus on
// `platform.<platformId>.chat.<verb>` (SubjectPlatformTwitchChatSend and
// friends in subjects.go); the `platform.` namespace is reserved for the
// engine, so a module or a workflow cannot make a provider speak.
//
// Must match shared/common/typescript/cloudevents/Platform/chat.ts.

// PlatformSubjectPrefix starts every provider subject.
const PlatformSubjectPrefix = "platform."

// PlatformChatSendSubject is the subject a platform's provider takes chat
// lines on.
func PlatformChatSendSubject(platformID string) string {
	return PlatformSubjectPrefix + platformID + ".chat.send"
}

// ChatSendRequest is the body of a `platform.<id>.chat.send` request.
// ReplyToMessageID is the platform's id of the message the line answers.
type ChatSendRequest struct {
	Message          string `json:"message"`
	ReplyToMessageID string `json:"replyToMessageId,omitempty"`
}

// AnnouncementColor is the highlight of a Twitch announcement.
type AnnouncementColor string

const (
	AnnouncementColorPrimary AnnouncementColor = "primary"
	AnnouncementColorBlue    AnnouncementColor = "blue"
	AnnouncementColorGreen   AnnouncementColor = "green"
	AnnouncementColorOrange  AnnouncementColor = "orange"
	AnnouncementColorPurple  AnnouncementColor = "purple"
)

// ParseAnnouncementColor accepts exactly the colors Twitch offers.
func ParseAnnouncementColor(value string) (AnnouncementColor, error) {
	switch color := AnnouncementColor(value); color {
	case AnnouncementColorPrimary, AnnouncementColorBlue, AnnouncementColorGreen,
		AnnouncementColorOrange, AnnouncementColorPurple:
		return color, nil
	}
	return "", fmt.Errorf("announcement color %q: must be primary, blue, green, orange or purple", value)
}

// ChatAnnounceRequest is the body of a `platform.twitch.chat.announce`
// request. An empty Color is Twitch's default, the channel's accent color.
type ChatAnnounceRequest struct {
	Message string            `json:"message"`
	Color   AnnouncementColor `json:"color,omitempty"`
}

// ChatSendErrorCode says why a provider did not send a line. See
// CHAT_SEND_ERROR_CODES in the TypeScript contract for what each means.
type ChatSendErrorCode string

const (
	ChatSendNotLinked   ChatSendErrorCode = "not_linked"
	ChatSendDropped     ChatSendErrorCode = "dropped"
	ChatSendRateLimited ChatSendErrorCode = "rate_limited"
	ChatSendInvalid     ChatSendErrorCode = "invalid"
	ChatSendUpstream    ChatSendErrorCode = "upstream"
)

func parseChatSendErrorCode(value string) (ChatSendErrorCode, error) {
	switch code := ChatSendErrorCode(value); code {
	case ChatSendNotLinked, ChatSendDropped, ChatSendRateLimited, ChatSendInvalid, ChatSendUpstream:
		return code, nil
	}
	return "", fmt.Errorf("unknown chat send error code %q", value)
}

// ChatSendError is a provider's refusal.
type ChatSendError struct {
	Code    ChatSendErrorCode `json:"code"`
	Message string            `json:"message"`
}

func (e *ChatSendError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// ChatSendReply is a provider's answer to a send or an announce. Exactly one
// of Sent and Error is set.
type ChatSendReply struct {
	Sent  *ChatSent
	Error *ChatSendError
}

// ChatSent is a reply for a request the platform accepted. IsSent is false
// when the platform dropped the line (Twitch's AutoMod, say), with
// DropReason saying why. MessageID is empty when the platform reports none,
// as Twitch does for an announcement.
type ChatSent struct {
	MessageID  string
	IsSent     bool
	DropReason string
}

// ErrMalformedChatSendReply wraps every reply DecodeChatSendReply refuses.
var ErrMalformedChatSendReply = errors.New("malformed chat send reply")

type chatSendReplyWire struct {
	OK         *bool          `json:"ok"`
	MessageID  string         `json:"messageId,omitempty"`
	IsSent     *bool          `json:"isSent,omitempty"`
	DropReason string         `json:"dropReason,omitempty"`
	Error      *ChatSendError `json:"error,omitempty"`
}

// DecodeChatSendReply reads a provider's reply, refusing one that does not
// hold to the contract: `ok` missing, `isSent` missing on success, an error
// without a known code or a message, or both halves at once.
func DecodeChatSendReply(data []byte) (ChatSendReply, error) {
	var wire chatSendReplyWire
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return ChatSendReply{}, fmt.Errorf("%w: %w", ErrMalformedChatSendReply, err)
	}
	if wire.OK == nil {
		return ChatSendReply{}, fmt.Errorf("%w: ok is missing", ErrMalformedChatSendReply)
	}
	if *wire.OK {
		if wire.Error != nil {
			return ChatSendReply{}, fmt.Errorf("%w: ok reply carries an error", ErrMalformedChatSendReply)
		}
		if wire.IsSent == nil {
			return ChatSendReply{}, fmt.Errorf("%w: isSent is missing", ErrMalformedChatSendReply)
		}
		return ChatSendReply{Sent: &ChatSent{
			MessageID:  wire.MessageID,
			IsSent:     *wire.IsSent,
			DropReason: wire.DropReason,
		}}, nil
	}
	if wire.IsSent != nil || wire.MessageID != "" || wire.DropReason != "" {
		return ChatSendReply{}, fmt.Errorf("%w: failed reply carries success fields", ErrMalformedChatSendReply)
	}
	if wire.Error == nil {
		return ChatSendReply{}, fmt.Errorf("%w: failed reply has no error", ErrMalformedChatSendReply)
	}
	code, err := parseChatSendErrorCode(string(wire.Error.Code))
	if err != nil {
		return ChatSendReply{}, fmt.Errorf("%w: %w", ErrMalformedChatSendReply, err)
	}
	if strings.TrimSpace(wire.Error.Message) == "" {
		return ChatSendReply{}, fmt.Errorf("%w: error message is empty", ErrMalformedChatSendReply)
	}
	return ChatSendReply{Error: &ChatSendError{Code: code, Message: wire.Error.Message}}, nil
}
