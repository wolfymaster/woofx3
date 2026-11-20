package scene_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/scene"
)

func TestSceneCommandRequestFixtures(t *testing.T) {
	fixturetest.Run[scene.SceneCommandRequest](t, "scene", "scene-command-request.json", "SceneCommandRequest")
}

func TestSceneCommandReplyFixtures(t *testing.T) {
	fixturetest.Run[scene.SceneCommandReply](t, "scene", "scene-command-reply.json", "SceneCommandReply")
}
