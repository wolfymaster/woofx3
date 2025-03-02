// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.5
// 	protoc        (unknown)
// source: event.proto

package buf

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
	unsafe "unsafe"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type UserEvent struct {
	state       protoimpl.MessageState `protogen:"open.v1"`
	UserId      string                 `protobuf:"bytes,1,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
	DisplayName string                 `protobuf:"bytes,2,opt,name=display_name,json=displayName,proto3" json:"display_name,omitempty"`
	EventType   string                 `protobuf:"bytes,3,opt,name=event_type,json=eventType,proto3" json:"event_type,omitempty"`
	// Types that are valid to be assigned to Event:
	//
	//	*UserEvent_BitCheer
	//	*UserEvent_Message
	//	*UserEvent_Subscribe
	//	*UserEvent_Follow
	Event         isUserEvent_Event `protobuf_oneof:"event"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *UserEvent) Reset() {
	*x = UserEvent{}
	mi := &file_event_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *UserEvent) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*UserEvent) ProtoMessage() {}

func (x *UserEvent) ProtoReflect() protoreflect.Message {
	mi := &file_event_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use UserEvent.ProtoReflect.Descriptor instead.
func (*UserEvent) Descriptor() ([]byte, []int) {
	return file_event_proto_rawDescGZIP(), []int{0}
}

func (x *UserEvent) GetUserId() string {
	if x != nil {
		return x.UserId
	}
	return ""
}

func (x *UserEvent) GetDisplayName() string {
	if x != nil {
		return x.DisplayName
	}
	return ""
}

func (x *UserEvent) GetEventType() string {
	if x != nil {
		return x.EventType
	}
	return ""
}

func (x *UserEvent) GetEvent() isUserEvent_Event {
	if x != nil {
		return x.Event
	}
	return nil
}

func (x *UserEvent) GetBitCheer() *BitCheerEvent {
	if x != nil {
		if x, ok := x.Event.(*UserEvent_BitCheer); ok {
			return x.BitCheer
		}
	}
	return nil
}

func (x *UserEvent) GetMessage() *MessageEvent {
	if x != nil {
		if x, ok := x.Event.(*UserEvent_Message); ok {
			return x.Message
		}
	}
	return nil
}

func (x *UserEvent) GetSubscribe() *SubscibeEvent {
	if x != nil {
		if x, ok := x.Event.(*UserEvent_Subscribe); ok {
			return x.Subscribe
		}
	}
	return nil
}

func (x *UserEvent) GetFollow() *FollowEvent {
	if x != nil {
		if x, ok := x.Event.(*UserEvent_Follow); ok {
			return x.Follow
		}
	}
	return nil
}

type isUserEvent_Event interface {
	isUserEvent_Event()
}

type UserEvent_BitCheer struct {
	BitCheer *BitCheerEvent `protobuf:"bytes,4,opt,name=bit_cheer,json=bitCheer,proto3,oneof"`
}

type UserEvent_Message struct {
	Message *MessageEvent `protobuf:"bytes,5,opt,name=message,proto3,oneof"`
}

type UserEvent_Subscribe struct {
	Subscribe *SubscibeEvent `protobuf:"bytes,6,opt,name=subscribe,proto3,oneof"`
}

type UserEvent_Follow struct {
	Follow *FollowEvent `protobuf:"bytes,7,opt,name=follow,proto3,oneof"`
}

func (*UserEvent_BitCheer) isUserEvent_Event() {}

func (*UserEvent_Message) isUserEvent_Event() {}

func (*UserEvent_Subscribe) isUserEvent_Event() {}

func (*UserEvent_Follow) isUserEvent_Event() {}

type CreateUserEventRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Event         *UserEvent             `protobuf:"bytes,1,opt,name=event,proto3" json:"event,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *CreateUserEventRequest) Reset() {
	*x = CreateUserEventRequest{}
	mi := &file_event_proto_msgTypes[1]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *CreateUserEventRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateUserEventRequest) ProtoMessage() {}

func (x *CreateUserEventRequest) ProtoReflect() protoreflect.Message {
	mi := &file_event_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use CreateUserEventRequest.ProtoReflect.Descriptor instead.
func (*CreateUserEventRequest) Descriptor() ([]byte, []int) {
	return file_event_proto_rawDescGZIP(), []int{1}
}

func (x *CreateUserEventRequest) GetEvent() *UserEvent {
	if x != nil {
		return x.Event
	}
	return nil
}

type CreateUserEventResponse struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Status        *ResponseStatus        `protobuf:"bytes,1,opt,name=status,proto3" json:"status,omitempty"`
	Event         *UserEvent             `protobuf:"bytes,2,opt,name=event,proto3" json:"event,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *CreateUserEventResponse) Reset() {
	*x = CreateUserEventResponse{}
	mi := &file_event_proto_msgTypes[2]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *CreateUserEventResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateUserEventResponse) ProtoMessage() {}

func (x *CreateUserEventResponse) ProtoReflect() protoreflect.Message {
	mi := &file_event_proto_msgTypes[2]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use CreateUserEventResponse.ProtoReflect.Descriptor instead.
func (*CreateUserEventResponse) Descriptor() ([]byte, []int) {
	return file_event_proto_rawDescGZIP(), []int{2}
}

func (x *CreateUserEventResponse) GetStatus() *ResponseStatus {
	if x != nil {
		return x.Status
	}
	return nil
}

func (x *CreateUserEventResponse) GetEvent() *UserEvent {
	if x != nil {
		return x.Event
	}
	return nil
}

type BitCheerEvent struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Amount        int32                  `protobuf:"varint,1,opt,name=amount,proto3" json:"amount,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *BitCheerEvent) Reset() {
	*x = BitCheerEvent{}
	mi := &file_event_proto_msgTypes[3]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *BitCheerEvent) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*BitCheerEvent) ProtoMessage() {}

func (x *BitCheerEvent) ProtoReflect() protoreflect.Message {
	mi := &file_event_proto_msgTypes[3]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use BitCheerEvent.ProtoReflect.Descriptor instead.
func (*BitCheerEvent) Descriptor() ([]byte, []int) {
	return file_event_proto_rawDescGZIP(), []int{3}
}

func (x *BitCheerEvent) GetAmount() int32 {
	if x != nil {
		return x.Amount
	}
	return 0
}

type MessageEvent struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Message       string                 `protobuf:"bytes,1,opt,name=message,proto3" json:"message,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *MessageEvent) Reset() {
	*x = MessageEvent{}
	mi := &file_event_proto_msgTypes[4]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *MessageEvent) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MessageEvent) ProtoMessage() {}

func (x *MessageEvent) ProtoReflect() protoreflect.Message {
	mi := &file_event_proto_msgTypes[4]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MessageEvent.ProtoReflect.Descriptor instead.
func (*MessageEvent) Descriptor() ([]byte, []int) {
	return file_event_proto_rawDescGZIP(), []int{4}
}

func (x *MessageEvent) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

type SubscibeEvent struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Tier          string                 `protobuf:"bytes,1,opt,name=tier,proto3" json:"tier,omitempty"`
	Gift          bool                   `protobuf:"varint,2,opt,name=gift,proto3" json:"gift,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *SubscibeEvent) Reset() {
	*x = SubscibeEvent{}
	mi := &file_event_proto_msgTypes[5]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *SubscibeEvent) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*SubscibeEvent) ProtoMessage() {}

func (x *SubscibeEvent) ProtoReflect() protoreflect.Message {
	mi := &file_event_proto_msgTypes[5]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use SubscibeEvent.ProtoReflect.Descriptor instead.
func (*SubscibeEvent) Descriptor() ([]byte, []int) {
	return file_event_proto_rawDescGZIP(), []int{5}
}

func (x *SubscibeEvent) GetTier() string {
	if x != nil {
		return x.Tier
	}
	return ""
}

func (x *SubscibeEvent) GetGift() bool {
	if x != nil {
		return x.Gift
	}
	return false
}

type FollowEvent struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	FollowDate    string                 `protobuf:"bytes,1,opt,name=follow_date,json=followDate,proto3" json:"follow_date,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *FollowEvent) Reset() {
	*x = FollowEvent{}
	mi := &file_event_proto_msgTypes[6]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *FollowEvent) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*FollowEvent) ProtoMessage() {}

func (x *FollowEvent) ProtoReflect() protoreflect.Message {
	mi := &file_event_proto_msgTypes[6]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use FollowEvent.ProtoReflect.Descriptor instead.
func (*FollowEvent) Descriptor() ([]byte, []int) {
	return file_event_proto_rawDescGZIP(), []int{6}
}

func (x *FollowEvent) GetFollowDate() string {
	if x != nil {
		return x.FollowDate
	}
	return ""
}

var File_event_proto protoreflect.FileDescriptor

var file_event_proto_rawDesc = string([]byte{
	0x0a, 0x0b, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x12, 0x0e, 0x77,
	0x6f, 0x6c, 0x66, 0x79, 0x74, 0x74, 0x76, 0x2e, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x1a, 0x0c, 0x63,
	0x6f, 0x6d, 0x6d, 0x6f, 0x6e, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x22, 0xdd, 0x02, 0x0a, 0x09,
	0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x12, 0x17, 0x0a, 0x07, 0x75, 0x73, 0x65,
	0x72, 0x5f, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x06, 0x75, 0x73, 0x65, 0x72,
	0x49, 0x64, 0x12, 0x21, 0x0a, 0x0c, 0x64, 0x69, 0x73, 0x70, 0x6c, 0x61, 0x79, 0x5f, 0x6e, 0x61,
	0x6d, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52, 0x0b, 0x64, 0x69, 0x73, 0x70, 0x6c, 0x61,
	0x79, 0x4e, 0x61, 0x6d, 0x65, 0x12, 0x1d, 0x0a, 0x0a, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x5f, 0x74,
	0x79, 0x70, 0x65, 0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x52, 0x09, 0x65, 0x76, 0x65, 0x6e, 0x74,
	0x54, 0x79, 0x70, 0x65, 0x12, 0x3c, 0x0a, 0x09, 0x62, 0x69, 0x74, 0x5f, 0x63, 0x68, 0x65, 0x65,
	0x72, 0x18, 0x04, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x1d, 0x2e, 0x77, 0x6f, 0x6c, 0x66, 0x79, 0x74,
	0x74, 0x76, 0x2e, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x2e, 0x42, 0x69, 0x74, 0x43, 0x68, 0x65, 0x65,
	0x72, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x48, 0x00, 0x52, 0x08, 0x62, 0x69, 0x74, 0x43, 0x68, 0x65,
	0x65, 0x72, 0x12, 0x38, 0x0a, 0x07, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x05, 0x20,
	0x01, 0x28, 0x0b, 0x32, 0x1c, 0x2e, 0x77, 0x6f, 0x6c, 0x66, 0x79, 0x74, 0x74, 0x76, 0x2e, 0x65,
	0x76, 0x65, 0x6e, 0x74, 0x2e, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x45, 0x76, 0x65, 0x6e,
	0x74, 0x48, 0x00, 0x52, 0x07, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x3d, 0x0a, 0x09,
	0x73, 0x75, 0x62, 0x73, 0x63, 0x72, 0x69, 0x62, 0x65, 0x18, 0x06, 0x20, 0x01, 0x28, 0x0b, 0x32,
	0x1d, 0x2e, 0x77, 0x6f, 0x6c, 0x66, 0x79, 0x74, 0x74, 0x76, 0x2e, 0x65, 0x76, 0x65, 0x6e, 0x74,
	0x2e, 0x53, 0x75, 0x62, 0x73, 0x63, 0x69, 0x62, 0x65, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x48, 0x00,
	0x52, 0x09, 0x73, 0x75, 0x62, 0x73, 0x63, 0x72, 0x69, 0x62, 0x65, 0x12, 0x35, 0x0a, 0x06, 0x66,
	0x6f, 0x6c, 0x6c, 0x6f, 0x77, 0x18, 0x07, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x1b, 0x2e, 0x77, 0x6f,
	0x6c, 0x66, 0x79, 0x74, 0x74, 0x76, 0x2e, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x2e, 0x46, 0x6f, 0x6c,
	0x6c, 0x6f, 0x77, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x48, 0x00, 0x52, 0x06, 0x66, 0x6f, 0x6c, 0x6c,
	0x6f, 0x77, 0x42, 0x07, 0x0a, 0x05, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x22, 0x49, 0x0a, 0x16, 0x43,
	0x72, 0x65, 0x61, 0x74, 0x65, 0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x52, 0x65,
	0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x2f, 0x0a, 0x05, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x18, 0x01,
	0x20, 0x01, 0x28, 0x0b, 0x32, 0x19, 0x2e, 0x77, 0x6f, 0x6c, 0x66, 0x79, 0x74, 0x74, 0x76, 0x2e,
	0x65, 0x76, 0x65, 0x6e, 0x74, 0x2e, 0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x52,
	0x05, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x22, 0x7a, 0x0a, 0x17, 0x43, 0x72, 0x65, 0x61, 0x74, 0x65,
	0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73,
	0x65, 0x12, 0x2e, 0x0a, 0x06, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x18, 0x01, 0x20, 0x01, 0x28,
	0x0b, 0x32, 0x16, 0x2e, 0x63, 0x6f, 0x6d, 0x6d, 0x6f, 0x6e, 0x2e, 0x52, 0x65, 0x73, 0x70, 0x6f,
	0x6e, 0x73, 0x65, 0x53, 0x74, 0x61, 0x74, 0x75, 0x73, 0x52, 0x06, 0x73, 0x74, 0x61, 0x74, 0x75,
	0x73, 0x12, 0x2f, 0x0a, 0x05, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x18, 0x02, 0x20, 0x01, 0x28, 0x0b,
	0x32, 0x19, 0x2e, 0x77, 0x6f, 0x6c, 0x66, 0x79, 0x74, 0x74, 0x76, 0x2e, 0x65, 0x76, 0x65, 0x6e,
	0x74, 0x2e, 0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x52, 0x05, 0x65, 0x76, 0x65,
	0x6e, 0x74, 0x22, 0x27, 0x0a, 0x0d, 0x42, 0x69, 0x74, 0x43, 0x68, 0x65, 0x65, 0x72, 0x45, 0x76,
	0x65, 0x6e, 0x74, 0x12, 0x16, 0x0a, 0x06, 0x61, 0x6d, 0x6f, 0x75, 0x6e, 0x74, 0x18, 0x01, 0x20,
	0x01, 0x28, 0x05, 0x52, 0x06, 0x61, 0x6d, 0x6f, 0x75, 0x6e, 0x74, 0x22, 0x28, 0x0a, 0x0c, 0x4d,
	0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x12, 0x18, 0x0a, 0x07, 0x6d,
	0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x07, 0x6d, 0x65,
	0x73, 0x73, 0x61, 0x67, 0x65, 0x22, 0x37, 0x0a, 0x0d, 0x53, 0x75, 0x62, 0x73, 0x63, 0x69, 0x62,
	0x65, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x12, 0x12, 0x0a, 0x04, 0x74, 0x69, 0x65, 0x72, 0x18, 0x01,
	0x20, 0x01, 0x28, 0x09, 0x52, 0x04, 0x74, 0x69, 0x65, 0x72, 0x12, 0x12, 0x0a, 0x04, 0x67, 0x69,
	0x66, 0x74, 0x18, 0x02, 0x20, 0x01, 0x28, 0x08, 0x52, 0x04, 0x67, 0x69, 0x66, 0x74, 0x22, 0x2e,
	0x0a, 0x0b, 0x46, 0x6f, 0x6c, 0x6c, 0x6f, 0x77, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x12, 0x1f, 0x0a,
	0x0b, 0x66, 0x6f, 0x6c, 0x6c, 0x6f, 0x77, 0x5f, 0x64, 0x61, 0x74, 0x65, 0x18, 0x01, 0x20, 0x01,
	0x28, 0x09, 0x52, 0x0a, 0x66, 0x6f, 0x6c, 0x6c, 0x6f, 0x77, 0x44, 0x61, 0x74, 0x65, 0x32, 0x72,
	0x0a, 0x0c, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x53, 0x65, 0x72, 0x76, 0x69, 0x63, 0x65, 0x12, 0x62,
	0x0a, 0x0f, 0x43, 0x72, 0x65, 0x61, 0x74, 0x65, 0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65, 0x6e,
	0x74, 0x12, 0x26, 0x2e, 0x77, 0x6f, 0x6c, 0x66, 0x79, 0x74, 0x74, 0x76, 0x2e, 0x65, 0x76, 0x65,
	0x6e, 0x74, 0x2e, 0x43, 0x72, 0x65, 0x61, 0x74, 0x65, 0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65,
	0x6e, 0x74, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x27, 0x2e, 0x77, 0x6f, 0x6c, 0x66,
	0x79, 0x74, 0x74, 0x76, 0x2e, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x2e, 0x43, 0x72, 0x65, 0x61, 0x74,
	0x65, 0x55, 0x73, 0x65, 0x72, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e,
	0x73, 0x65, 0x42, 0x25, 0x5a, 0x23, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62, 0x2e, 0x63, 0x6f, 0x6d,
	0x2f, 0x77, 0x6f, 0x6c, 0x66, 0x79, 0x6d, 0x61, 0x73, 0x74, 0x65, 0x72, 0x2f, 0x77, 0x6f, 0x6c,
	0x66, 0x79, 0x74, 0x74, 0x76, 0x2f, 0x62, 0x75, 0x66, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x33,
})

var (
	file_event_proto_rawDescOnce sync.Once
	file_event_proto_rawDescData []byte
)

func file_event_proto_rawDescGZIP() []byte {
	file_event_proto_rawDescOnce.Do(func() {
		file_event_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_event_proto_rawDesc), len(file_event_proto_rawDesc)))
	})
	return file_event_proto_rawDescData
}

var file_event_proto_msgTypes = make([]protoimpl.MessageInfo, 7)
var file_event_proto_goTypes = []any{
	(*UserEvent)(nil),               // 0: wolfyttv.event.UserEvent
	(*CreateUserEventRequest)(nil),  // 1: wolfyttv.event.CreateUserEventRequest
	(*CreateUserEventResponse)(nil), // 2: wolfyttv.event.CreateUserEventResponse
	(*BitCheerEvent)(nil),           // 3: wolfyttv.event.BitCheerEvent
	(*MessageEvent)(nil),            // 4: wolfyttv.event.MessageEvent
	(*SubscibeEvent)(nil),           // 5: wolfyttv.event.SubscibeEvent
	(*FollowEvent)(nil),             // 6: wolfyttv.event.FollowEvent
	(*ResponseStatus)(nil),          // 7: common.ResponseStatus
}
var file_event_proto_depIdxs = []int32{
	3, // 0: wolfyttv.event.UserEvent.bit_cheer:type_name -> wolfyttv.event.BitCheerEvent
	4, // 1: wolfyttv.event.UserEvent.message:type_name -> wolfyttv.event.MessageEvent
	5, // 2: wolfyttv.event.UserEvent.subscribe:type_name -> wolfyttv.event.SubscibeEvent
	6, // 3: wolfyttv.event.UserEvent.follow:type_name -> wolfyttv.event.FollowEvent
	0, // 4: wolfyttv.event.CreateUserEventRequest.event:type_name -> wolfyttv.event.UserEvent
	7, // 5: wolfyttv.event.CreateUserEventResponse.status:type_name -> common.ResponseStatus
	0, // 6: wolfyttv.event.CreateUserEventResponse.event:type_name -> wolfyttv.event.UserEvent
	1, // 7: wolfyttv.event.EventService.CreateUserEvent:input_type -> wolfyttv.event.CreateUserEventRequest
	2, // 8: wolfyttv.event.EventService.CreateUserEvent:output_type -> wolfyttv.event.CreateUserEventResponse
	8, // [8:9] is the sub-list for method output_type
	7, // [7:8] is the sub-list for method input_type
	7, // [7:7] is the sub-list for extension type_name
	7, // [7:7] is the sub-list for extension extendee
	0, // [0:7] is the sub-list for field type_name
}

func init() { file_event_proto_init() }
func file_event_proto_init() {
	if File_event_proto != nil {
		return
	}
	file_common_proto_init()
	file_event_proto_msgTypes[0].OneofWrappers = []any{
		(*UserEvent_BitCheer)(nil),
		(*UserEvent_Message)(nil),
		(*UserEvent_Subscribe)(nil),
		(*UserEvent_Follow)(nil),
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_event_proto_rawDesc), len(file_event_proto_rawDesc)),
			NumEnums:      0,
			NumMessages:   7,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_event_proto_goTypes,
		DependencyIndexes: file_event_proto_depIdxs,
		MessageInfos:      file_event_proto_msgTypes,
	}.Build()
	File_event_proto = out.File
	file_event_proto_goTypes = nil
	file_event_proto_depIdxs = nil
}
