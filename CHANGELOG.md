# Changelog

## [0.40.0](https://github.com/wolfymaster/woofx3/compare/v0.39.0...v0.40.0) (2026-10-21)

### Features

* **api:** add the engine event stream transport ([0ef460f](https://github.com/wolfymaster/woofx3/commit/0ef460f265ad484b882c61a12406d56b306a647b))
* **api:** deliver engine callbacks over webhooks and the event stream ([5b9be18](https://github.com/wolfymaster/woofx3/commit/5b9be187b461e559b22732019da56eb046109774))
* **api:** link Twitch from the engine with a device login ([fac8f33](https://github.com/wolfymaster/woofx3/commit/fac8f3399c499523a9147776437f7820d700cd86))
* **api:** read alerts, run detail, resource kinds and the workflow catalog ([edf1a1c](https://github.com/wolfymaster/woofx3/commit/edf1a1c4fe9f99e0546d8086c504a5a28be970e5))
* **api:** refresh public-app Twitch tokens in the api service alone ([cb4619d](https://github.com/wolfymaster/woofx3/commit/cb4619d06e69d34eb294638a4c54d2cb7a5ebb54))
* **api:** serve local UI settings behind ui.settings ([4e9e404](https://github.com/wolfymaster/woofx3/commit/4e9e4044306201c0cd8b4a3eddd3c876716444cc))
* **api:** serve subscribeEngineEvents and answerEngineRequest ([1105e60](https://github.com/wolfymaster/woofx3/commit/1105e601250b0e0f3d1aaa9cf88ca42480b67de1))
* **db:** declare LocalUISettingService ([b530445](https://github.com/wolfymaster/woofx3/commit/b53044530361ef951d4e05ff01cf1e0ba987790c))
* **db:** filter alerts by run and identify run steps in the proto ([eadbcd4](https://github.com/wolfymaster/woofx3/commit/eadbcd40559195e401de0e3ba65ef7d12c79f7e9))
* **db:** serve the alert run filter and step identity ([70aa348](https://github.com/wolfymaster/woofx3/commit/70aa348b7dc0e4f5c6dd0ddcdf8ab2a76ec48fd7))
* **db:** split local ui setting set and delete responses ([9029b22](https://github.com/wolfymaster/woofx3/commit/9029b2289d34d7907811f37a42b6b30422f46cf4))
* **db:** store local UI settings under one revision counter ([4074638](https://github.com/wolfymaster/woofx3/commit/4074638c8e77dc0deed3f9fd2f89b2a006b796a3))
* **scenemanager:** answer widget.queue.state with the overlays' queue ([314def2](https://github.com/wolfymaster/woofx3/commit/314def2136f5fe2b4beb708eaf380499809380aa))
* **twitch:** public-app OAuth client and api-served device-login tokens ([c9231f1](https://github.com/wolfymaster/woofx3/commit/c9231f115724bc3f88f311b5fb7d99f4a2b174dc))

### Bug Fixes

* **api:** drop a deleted client's event stream subscriptions ([fe9e1a9](https://github.com/wolfymaster/woofx3/commit/fe9e1a98ed4e1e664aa5b0a7ea85076168d41e36))
* **api:** drop an event stream subscription whose push never settles ([91e4199](https://github.com/wolfymaster/woofx3/commit/91e4199c2de61084abb4255a36066ed6e493d598))
* **api:** fail findWorkflow on a non-OK envelope ([71132d7](https://github.com/wolfymaster/woofx3/commit/71132d7256ec63875914ec8096326118fd2102f7))
* **api:** give every twitch_token write in the api one owner ([c270aec](https://github.com/wolfymaster/woofx3/commit/c270aec17f922f0ce0a71d8b88687cb3a042cafa))
* **api:** give run callbacks the stored-read timestamp layout ([c8a9ad2](https://github.com/wolfymaster/woofx3/commit/c8a9ad2467047ecb96abc436fcb78322c6a3290d))
* **api:** inject the device login's retry jitter ([228f319](https://github.com/wolfymaster/woofx3/commit/228f3197428d35f33ff5b76a2ec37ead3a9073e6))
* **api:** let a device login that is storing its token end linked ([c7c72f7](https://github.com/wolfymaster/woofx3/commit/c7c72f70202ea5aeb9f05db400495e35bbefc9eb))
* **api:** read a missing workflow or run as null ([3beae24](https://github.com/wolfymaster/woofx3/commit/3beae2481e45b8c21f92c307bac3d31967783088))
* **api:** read an absent row in a write conflict as never written ([65dfa5e](https://github.com/wolfymaster/woofx3/commit/65dfa5ee2d616f9de7600127a37680105142150c))
* **api:** refuse an empty target client id in WebhookClient.send ([b86e9ba](https://github.com/wolfymaster/woofx3/commit/b86e9ba05abb3935f3d838996ccb3e36176a2afd))
* **api:** refuse unknown event types in subscribeEngineEvents ([4c63be0](https://github.com/wolfymaster/woofx3/commit/4c63be07d8655bd60e2dd73d6111db707408bfe4))
* **api:** skip event stream request frames nobody is waiting for ([9807918](https://github.com/wolfymaster/woofx3/commit/9807918c0bfdfdc9f18aaa4d914d79be799c2e7c))
* **api:** stop the engine event stream on shutdown ([b788da2](https://github.com/wolfymaster/woofx3/commit/b788da21740be382971a15d1c85d39e91359ceca))
* **api:** validate the scene manager's alert queue reply ([7a4fc13](https://github.com/wolfymaster/woofx3/commit/7a4fc13e76ef630d7a1dbbfcf2b52a22c67d0815))
* **ci:** give the image checks a well-formed Twitch client id ([2ba941f](https://github.com/wolfymaster/woofx3/commit/2ba941fcec67e162bffc8e2c91755c30c4af7813))
* **db:** number the local UI settings migration after scene backups ([1cb92e6](https://github.com/wolfymaster/woofx3/commit/1cb92e69d36b098bd4d1bbe7af5a3f7b70ed5a2c))
* **db:** pass request ctx through local ui setting queries ([75431fd](https://github.com/wolfymaster/woofx3/commit/75431fd829e975277311e6c4f471185bd349f9cc))
* **db:** report failed run and workflow reads as internal errors ([f11a692](https://github.com/wolfymaster/woofx3/commit/f11a692bf7c3ca870d40c74b10c734c6866a1e1d))
* **db:** seal the twitch_token setting at rest ([dab7904](https://github.com/wolfymaster/woofx3/commit/dab79040da7f7d73c853f7e221422f95d42936e7))
* **twitch:** reconnect when a relink switches how the token is renewed ([c1762c1](https://github.com/wolfymaster/woofx3/commit/c1762c17943dd2cbbbacca185f2f290bc64ffe52))
* **twitch:** time out and wrap every OAuth body read ([87436a0](https://github.com/wolfymaster/woofx3/commit/87436a03ee7fc3378d8ee92d30626e73279d3fd9))

## [0.39.0](https://github.com/wolfymaster/woofx3/compare/v0.38.0...v0.39.0) (2026-10-21)

### Features

* **api:** getModuleStorageUsage ([9760bef](https://github.com/wolfymaster/woofx3/commit/9760befc4af59db1f5ec03d52b42211af1ad7e6e))
* **db:** report module storage size ([0b24158](https://github.com/wolfymaster/woofx3/commit/0b24158c29780b1fcdb4d62d1a4eebd6b6fe5785))

### Bug Fixes

* **api:** keep stream and trigger subscription callbacks alive ([84bfcaf](https://github.com/wolfymaster/woofx3/commit/84bfcaf21609507c073b956ad0fbb1bd34b7bf28))

## [0.38.0](https://github.com/wolfymaster/woofx3/compare/v0.37.0...v0.38.0) (2026-10-21)

### ⚠ BREAKING CHANGES

* the streamlabs service and its Streamlabs OBS bridge are gone.
* the chat bot no longer has !sc, !src, !follow or !time,
and nothing answers the `slobs` subject. Rebuild scene and source chat
commands in the commands UI with the OBS module's actions.

### Features

* **db:** keep scene data a repair replaces in scene_backups ([f015350](https://github.com/wolfymaster/woofx3/commit/f015350a6f82025537e1f5edc0ae6f67bc79be90))
* **module-sdk:** let a widget redraw itself on a settings change ([50f5106](https://github.com/wolfymaster/woofx3/commit/50f5106a2ceaf41f3859e1bd00e36f46e7c07d53))
* **module-sdk:** one contract for the engine asset paths widgets read ([1b4a060](https://github.com/wolfymaster/woofx3/commit/1b4a0604c66dd7bbf05cc1fea77d65cf19eccc2a))
* **obs:** set a source visible, hidden or toggled ([e3047f6](https://github.com/wolfymaster/woofx3/commit/e3047f6ffab6818f29ad60fcdff13690e951a298)), closes [woofx3-modules#52](https://github.com/wolfymaster/woofx3-modules/issues/52)
* **sceneManager:** one contract for the overlay stream and its acks ([43bd3fe](https://github.com/wolfymaster/woofx3/commit/43bd3feb7adc97c669c81283b95b46c976eb2d1c))
* **sceneManager:** report and repair scene data it cannot read ([65bcb82](https://github.com/wolfymaster/woofx3/commit/65bcb82139917465fbd38ee2b9e466c37b058c50))
* **scene:** one codec for stored placements and canonical widget ids ([0a7c369](https://github.com/wolfymaster/woofx3/commit/0a7c3694ee136e45e258afa0dc182de5ec085e48))
* **widgets:** read the widget protocol through shared guards, with one capability set ([e7dbb4e](https://github.com/wolfymaster/woofx3/commit/e7dbb4e2fd291fa8aa1f9d97d5f5f6fdbab2ff88))
* **woofx3:** edit the counter, timer and text widgets in place ([68b623c](https://github.com/wolfymaster/woofx3/commit/68b623c21156a97c782e83ed04a442ec932d6b60))

### Bug Fixes

* **module-sdk:** match the mock's argument checks to the shim's ([9fae6f7](https://github.com/wolfymaster/woofx3/commit/9fae6f7081a0f5236605a1cd717efc9445d64f09))
* **nats:** keep a subscription alive when one handler fails ([f0902bb](https://github.com/wolfymaster/woofx3/commit/f0902bbf16cc66d22b43e0caeecd8a2dd221beaa))
* **sceneManager:** bound session renewals and drop silent catches ([4b01ddd](https://github.com/wolfymaster/woofx3/commit/4b01ddd4fbc69dc4abe69688b7621543150a2091))
* **sceneManager:** check every placement when reading a scene config ([2e57995](https://github.com/wolfymaster/woofx3/commit/2e5799592a12f6a6dd1034447bb1a23f21bed6c7))
* **sceneManager:** close the bus connection on shutdown and failed start ([34c68f3](https://github.com/wolfymaster/woofx3/commit/34c68f30fc61dd4c83eb0e7d2551e1d60c64df99))
* **sceneManager:** deliver each widget event once, to the frame that is showing ([178dcee](https://github.com/wolfymaster/woofx3/commit/178dceea24755f1520d4f4f936f95ccb2df901f9))
* **sceneManager:** file widget status under the placement's module, not the widget's claim ([c6f1f87](https://github.com/wolfymaster/woofx3/commit/c6f1f875574bb8e7923676de4629ecd402405f91))
* **sceneManager:** give up on an OBS session that never finishes opening ([cee36c7](https://github.com/wolfymaster/woofx3/commit/cee36c7316f568376169ce134090be598eada03a))
* **sceneManager:** hand an alert area's queue over when it is remounted ([381cc78](https://github.com/wolfymaster/woofx3/commit/381cc78010e459a6a97edcdad741cb4f08a11e4a))
* **sceneManager:** keep unreadable placements in step with the draft ([b4d9096](https://github.com/wolfymaster/woofx3/commit/b4d909657fdf0fb9831a1ca0a72b64307076a77f))
* **sceneManager:** let a replayed delivery wait a full sweep interval ([da71423](https://github.com/wolfymaster/woofx3/commit/da71423b60529251b48778cc98c22787ffcf81ff))
* **sceneManager:** let go of widget asset reads after a minute ([5e6e1fb](https://github.com/wolfymaster/woofx3/commit/5e6e1fb56997b36643ca253dda696f3fc091a410))
* **sceneManager:** never cache a token answer older than an invalidation ([d8eaeb0](https://github.com/wolfymaster/woofx3/commit/d8eaeb0d6613263f633d25ccd93bce8289cc243c))
* **sceneManager:** never delete stored scene data the loader could not read ([5ca6e41](https://github.com/wolfymaster/woofx3/commit/5ca6e4141670446d61223571ceaec9bf393be333))
* **sceneManager:** never roll a scene back to a stale config snapshot ([46375bd](https://github.com/wolfymaster/woofx3/commit/46375bd0d43728adc73c6a2d3a74859287429ef0))
* **sceneManager:** never write a scene over a column it could not read ([8560185](https://github.com/wolfymaster/woofx3/commit/856018583cf68080981497f921586b7ffc80002d))
* **sceneManager:** re-verify long overlay sessions, reconcile cancels, close orphaned deliveries, bound the token cache ([fe5b341](https://github.com/wolfymaster/woofx3/commit/fe5b3412534cba0d5bd8f6f196aa04e06c1fac4f))
* **sceneManager:** reconcile replaced queues against a new stream's open set ([5d13363](https://github.com/wolfymaster/woofx3/commit/5d1336325ef47b8ab20b920b47859e359d89587c))
* **sceneManager:** refuse a missing db proxy URL or a bad port at startup ([133d991](https://github.com/wolfymaster/woofx3/commit/133d99122aee9df685ecbb8f2f0bb792360b354a))
* **sceneManager:** refuse scene changes once the documents are closed ([ee6b3c4](https://github.com/wolfymaster/woofx3/commit/ee6b3c4f5b8deb37e700edabf9cf258a1ab62c9e))
* **sceneManager:** reload only this overlay when its stream session lapses ([18b4503](https://github.com/wolfymaster/woofx3/commit/18b450368d41b52383659968122ead6c10755aac))
* **sceneManager:** renew the alert preview's session as an overlay's ([ede7254](https://github.com/wolfymaster/woofx3/commit/ede7254a4140ecf88cc8e4338cb17a769420a98c))
* **sceneManager:** report a completed delivery only if this ack closed it ([e371811](https://github.com/wolfymaster/woofx3/commit/e371811fcfbd4b2e05135d5a89b2d219252b5c67))
* **sceneManager:** retry hydrating open deliveries until the db answers ([8ac018b](https://github.com/wolfymaster/woofx3/commit/8ac018bb3aaf73ab7e0a1c1933c7bc76afed3fd1))
* **sceneManager:** sign an overlay in again when its session lapses ([f0afc7d](https://github.com/wolfymaster/woofx3/commit/f0afc7d50fa2ae76e827c0b7c145141181c11861))
* **sceneManager:** stop the server forcibly on shutdown ([77b769f](https://github.com/wolfymaster/woofx3/commit/77b769f6d5cb4b8ee61e4e6053d658bda5325b6a))

### Performance Improvements

* **sceneManager:** apply live edits as ops in the editor's preview ([cedd0ee](https://github.com/wolfymaster/woofx3/commit/cedd0ee5bc6b7710241e376bef47e60cd4cb0387))

### Code Refactoring

* remove the reward service and the legacy slobs subject ([ab65be0](https://github.com/wolfymaster/woofx3/commit/ab65be01cf1f71ff0242b1ee2261ecc9604c7e82))
* remove the streamlabs service ([29d37b9](https://github.com/wolfymaster/woofx3/commit/29d37b922d0fecf54b225e024d9895bd8a1253f2))

## [0.37.0](https://github.com/wolfymaster/woofx3/compare/v0.36.0...v0.37.0) (2026-10-20)

### Features

* **orchestrator:** copy existing data into a new data directory ([e97fba9](https://github.com/wolfymaster/woofx3/commit/e97fba903d1463b6c54afecdf44452c4533a1485))

### Bug Fixes

* **deps:** upgrade the root zod to 4.6.6 ([1efe20a](https://github.com/wolfymaster/woofx3/commit/1efe20a8cc03fedfbce168d8c2702290f992da2f))
* **deps:** upgrade zod to 4 in api, sceneManager, woofwoofwoof and runtime ([a3b4c64](https://github.com/wolfymaster/woofx3/commit/a3b4c647edd94e083c9ade7e90718f619f7ca351))
* twitch/package.json & twitch/package-lock.json to reduce vulnerabilities ([a34593c](https://github.com/wolfymaster/woofx3/commit/a34593c3e3534e7602dd366604da826e77e841fd))

## [0.36.0](https://github.com/wolfymaster/woofx3/compare/v0.35.0...v0.36.0) (2026-10-19)

### Features

* **api:** list the values ${viewer.*} can resolve ([ea885fc](https://github.com/wolfymaster/woofx3/commit/ea885fcfcbf19fdf147fb358ce5ea5ad23f8b6f6))
* **api:** return an action's sentence to the dashboard ([941dc02](https://github.com/wolfymaster/woofx3/commit/941dc02c629e55d4b7e145295707778fbc18fcf8))
* **barkloader:** let actions declare the sentence that describes them ([7221ffb](https://github.com/wolfymaster/woofx3/commit/7221ffb929d16b7b38322aec8dfcde7a976b9c0a))
* **barkloader:** let emitted fields list their known values ([37f027c](https://github.com/wolfymaster/woofx3/commit/37f027c414b3a5a0d33214a73ae79e9a06f48f62))
* **commands:** run each chat command's steps as a stored workflow ([e28b19f](https://github.com/wolfymaster/woofx3/commit/e28b19f785069fd7f2570c3dd4d11f4db5eae736))
* **db:** store the sentence an action declares ([d546ef2](https://github.com/wolfymaster/woofx3/commit/d546ef2026b32612365866ce19e7c91a848cc83e))
* **woofx3:** describe bundled actions with sentences ([2968a7b](https://github.com/wolfymaster/woofx3/commit/2968a7b3dde796867c4c40a083f919fee33b9770))
* **woofx3:** file bundled actions by purpose, not as system ([a0405f4](https://github.com/wolfymaster/woofx3/commit/a0405f4685c2f901f437af1f0bef8b96631fb80b))

### Bug Fixes

* **workflow:** keep wait count and sum current, empty data after a timeout ([019764b](https://github.com/wolfymaster/woofx3/commit/019764b18ea5b9e7ba1924930b15fbf2abaf2bc7))
* **workflow:** resolve references inside a condition's list value ([857bcb5](https://github.com/wolfymaster/woofx3/commit/857bcb5bc25d53bb49e8fa48925368713c17c30d))
* **workflow:** run condition branches like a step list ([c9edec4](https://github.com/wolfymaster/woofx3/commit/c9edec491c34dff5bde8aefa80adc0021304a68d))

## [0.35.0](https://github.com/wolfymaster/woofx3/compare/v0.34.2...v0.35.0) (2026-10-18)

### Features

* **api:** opt-in bearer check on barkloader processing callbacks ([9017240](https://github.com/wolfymaster/woofx3/commit/90172404fa7da7169fd896c58f83f19fca4ae33d))
* **barkloader:** send the engine secret with processing callbacks ([df45cde](https://github.com/wolfymaster/woofx3/commit/df45cde620120c54b7ab276ddce53f5991606b4f))
* opt-in Host and Origin guard for the api and sceneManager ([592f0ae](https://github.com/wolfymaster/woofx3/commit/592f0ae6e27936765bdaba30ee899804fb291dfb))
* registration modes and a generated registration token file ([32b0067](https://github.com/wolfymaster/woofx3/commit/32b00678c367cb16617c4775da36ce589edda66b))
* **release:** record the first release of each engine capability id ([02070d7](https://github.com/wolfymaster/woofx3/commit/02070d7ef2a84472e488549b131f9690ec39ca03))

### Bug Fixes

* **api:** refuse an unrenewable dashboard Twitch token instead of using it as the engine's own ([9f447d4](https://github.com/wolfymaster/woofx3/commit/9f447d4e8e6bf88cfce4b359ecf5f2717d89bb3c))
* **db:** keep Windows SQLite paths out of the data directory ([8cc8fd1](https://github.com/wolfymaster/woofx3/commit/8cc8fd1df44e7f7d8f0951124438eb48aa2af562))
* **http:** let WOOFX3_ALLOWED_ORIGINS list tauri://localhost ([b262b7c](https://github.com/wolfymaster/woofx3/commit/b262b7c08dbcc99e45f06e6a1e35365719b4e368))
* **nats:** read WebSocket settings under their documented spelling ([b9e9890](https://github.com/wolfymaster/woofx3/commit/b9e989041fee0eb0cb7156e74e6c2f987eb89ed8))
* **release:** fail the Since fill on git errors instead of skipping the tag ([7ae5adf](https://github.com/wolfymaster/woofx3/commit/7ae5adfbf56246fe8d0b16bc21952ade3a6e9e47))
* **release:** fail the Since fill when a declared id has no table row ([d9dbdd2](https://github.com/wolfymaster/woofx3/commit/d9dbdd2f62fcdcf570d2462d202ef4109c1ba998))
* **release:** fail the Since fill when capabilities.ts does not parse ([a12d08a](https://github.com/wolfymaster/woofx3/commit/a12d08ab927e2c0cead521bbea6265e2841fec32))
* **release:** reject capability rows with a malformed Since cell ([228e27a](https://github.com/wolfymaster/woofx3/commit/228e27a767f2c9b558d26f5f5b471c1d5d42c1d9))
* **runtime:** fail on a config file that is not a JSON object ([91d6187](https://github.com/wolfymaster/woofx3/commit/91d61873a403711340d375bf660645b909ffc028))
* **runtime:** refuse a relative WOOFX3_DATA_DIR ([4c71242](https://github.com/wolfymaster/woofx3/commit/4c712420958964b6e7a2cad1ddcf79eec4cb27ca))

## [0.34.2](https://github.com/wolfymaster/woofx3/compare/v0.34.1...v0.34.2) (2026-10-17)

### Bug Fixes

* **sceneManager:** bind the overlay's asset reads to the global fetch ([2d5c590](https://github.com/wolfymaster/woofx3/commit/2d5c5909a9d06c1bca4e24771390af54e90032d3))

## [0.34.1](https://github.com/wolfymaster/woofx3/compare/v0.34.0...v0.34.1) (2026-10-17)

### Bug Fixes

* **sceneManager:** stop failing every asset revalidation with a 502 ([67cc50a](https://github.com/wolfymaster/woofx3/commit/67cc50a672424e30461ff25d7e5e053af6a3a174))

## [0.34.0](https://github.com/wolfymaster/woofx3/compare/v0.33.0...v0.34.0) (2026-10-17)

### Features

* **widgets:** close widget frames to connections of their own ([5a587d4](https://github.com/wolfymaster/woofx3/commit/5a587d423e73728fbcd12fa83802f517ebb48ea7))
* **widgets:** let widgets read asset bytes through the host ([bdcad9c](https://github.com/wolfymaster/woofx3/commit/bdcad9c2e849d149949a12e617a0bb5ebb44e2bb))

## [0.33.0](https://github.com/wolfymaster/woofx3/compare/v0.32.1...v0.33.0) (2026-10-16)

### Features

* **api:** list the build's capabilities in GET /health ([48dd47a](https://github.com/wolfymaster/woofx3/commit/48dd47ab2ba9428d1bd3772f269c15bd1879458a))

## [0.32.1](https://github.com/wolfymaster/woofx3/compare/v0.32.0...v0.32.1) (2026-10-16)

### Bug Fixes

* **sceneManager:** give a scene stored without a canvas size the default canvas ([c94baf5](https://github.com/wolfymaster/woofx3/commit/c94baf514e4192d050c5581215b4a5baac715f1a))

## [0.32.0](https://github.com/wolfymaster/woofx3/compare/v0.31.0...v0.32.0) (2026-10-15)

### Features

* **api:** compact each stream session as it is summarised ([be35d4f](https://github.com/wolfymaster/woofx3/commit/be35d4f7a5094a3984cac6073fbf4caaa718fb70))
* **api:** let the streamer's selection decide which events are logged and pushed ([f063613](https://github.com/wolfymaster/woofx3/commit/f063613319a2c3106ed9ed1e8c2f2c27777d597f))
* **api:** log and push every event an installed trigger fires ([0fd9a9d](https://github.com/wolfymaster/woofx3/commit/0fd9a9d37d166dd9c07f2bc1ca0474b6bfc807c6))
* **api:** read the event log a page at a time with listEvents ([5e4485a](https://github.com/wolfymaster/woofx3/commit/5e4485a80c68a79310b50276dd428b11e50a31bc))
* **db:** keep each ended stream's analytics in compact tables ([b56273a](https://github.com/wolfymaster/woofx3/commit/b56273a2bc374eb460f3afff4b6840e937f31ac5))
* **db:** page the event log by type, back to its start ([e551007](https://github.com/wolfymaster/woofx3/commit/e55100799ba05617905bf25e49245804e4f9ce29))
* **db:** prune event detail older than the retention window ([d178c77](https://github.com/wolfymaster/woofx3/commit/d178c774ad11c51d0bab31d48ed6c521caa3f920))

### Bug Fixes

* **api:** keep the dashboard's recent activity to viewer activity ([3c800d3](https://github.com/wolfymaster/woofx3/commit/3c800d3fe1684ac4a97ae32753cee3b3a5c64bc3))

### Performance Improvements

* **api:** skip counting the span when listEvents pages ([66d38a7](https://github.com/wolfymaster/woofx3/commit/66d38a786d934cdc63d8eb17b02bc052248a77ea))

## [0.31.0](https://github.com/wolfymaster/woofx3/compare/v0.30.0...v0.31.0) (2026-10-14)

### Features

* **modules:** let a trigger's emits declare an alert summary ([4f1e83e](https://github.com/wolfymaster/woofx3/commit/4f1e83e9dcf2c7359f36fd7c38d29d3557d12622))

## [0.30.0](https://github.com/wolfymaster/woofx3/compare/v0.29.1...v0.30.0) (2026-10-13)

### Features

* **assets:** bind upload grants to their exact size and report usage ([369133a](https://github.com/wolfymaster/woofx3/commit/369133aaaa754cbe3ee438e1b55c1a868e6b93c1))

## [0.29.1](https://github.com/wolfymaster/woofx3/compare/v0.29.0...v0.29.1) (2026-10-12)

### Bug Fixes

* **dev:** stop worktree processes on rm instead of retrying migrations ([e812a5f](https://github.com/wolfymaster/woofx3/commit/e812a5f3dbf86a11741cf699543136815de4cc9a))

## [0.29.0](https://github.com/wolfymaster/woofx3/compare/v0.28.0...v0.29.0) (2026-10-12)

### Features

* **api:** advertise the alerts.queueControls capability ([1016bba](https://github.com/wolfymaster/woofx3/commit/1016bba3e9c4814764928a611fabc52834badcd9))
* **api:** expose the kinds each widget declares ([9bbf31d](https://github.com/wolfymaster/woofx3/commit/9bbf31d8478997f9536787d296bf099149a6b753))
* **api:** getCompositionPreviewUrl, advertised as compositions.preview ([c6314cb](https://github.com/wolfymaster/woofx3/commit/c6314cb70a7f2123f7642caf5dd6e6125abb6d18))
* **api:** serve alert compositions beside scenes ([cb24ebd](https://github.com/wolfymaster/woofx3/commit/cb24ebd55b5fe27b7f669795b37d675f3a154279))
* **barkloader:** let an emits field say which viewer an event is about ([046d9fe](https://github.com/wolfymaster/woofx3/commit/046d9fe0371de46d412b4844aa7620298249d53b))
* **barkloader:** refuse uploads that declare viewer.* events ([4585785](https://github.com/wolfymaster/woofx3/commit/45857856e2f8894aaa11fe1ea87d1afb98e83836))
* **barkloader:** reject unknown data-shape keys and ambiguous display names ([7835ed3](https://github.com/wolfymaster/woofx3/commit/7835ed3a699431c9053319d0679dcb48f65b3e10))
* **cloudevents:** reserve the viewer. namespace for segment edge events ([a315aaa](https://github.com/wolfymaster/woofx3/commit/a315aaa94023e8c8e7c660df65a1ecb95bfbeff1))
* **db:** add viewer segment tables and their repository ([e02a35a](https://github.com/wolfymaster/woofx3/commit/e02a35adacfab347113c65a322c24a0c2ebbe679))
* **db:** evaluate viewer segments and announce their edges ([d33531d](https://github.com/wolfymaster/woofx3/commit/d33531d04f822baa2d52d84684ba1ea5f84a50a2))
* **db:** mark segments whose membership is behind, and test the refill lock ([3825fe1](https://github.com/wolfymaster/woofx3/commit/3825fe159f95266beb8ff3ee3630ec9ee7aad255))
* **db:** nest an edge's facts by owner and slug ([6d12577](https://github.com/wolfymaster/woofx3/commit/6d12577bcb956d9b3ecfed1dc1ce95a0c77f3a64))
* **db:** refuse a fact whose where tree uses an unknown operator ([df9cd2a](https://github.com/wolfymaster/woofx3/commit/df9cd2ae6f1fab5286ea129f7f3095c48b41afe0))
* **db:** serve viewer fact definitions and deltas over ViewerFactService ([2230042](https://github.com/wolfymaster/woofx3/commit/22300428e9a7359ea5e5cc4830a4ef442cd1f3d6))
* **db:** store composition kind, behaviors and inputs ([2b18cc1](https://github.com/wolfymaster/woofx3/commit/2b18cc1a6c3cf441863eb2412acf1942aae9c1bb))
* **db:** store per-viewer fact values ([9820dcb](https://github.com/wolfymaster/woofx3/commit/9820dcb9e6fa8ea3fd41e046abc0eab7bfeb717d))
* **module-sdk:** let the host hand a widget behaviors it plays itself ([90485c7](https://github.com/wolfymaster/woofx3/commit/90485c729413ac7e8ec93c04897064c5c6c80080))
* **modules:** add viewer segment entered and left triggers ([54409f5](https://github.com/wolfymaster/woofx3/commit/54409f55a1f1fe84559dd54094a03cd06810937a))
* **modules:** describe nested edge facts and move woofx3 to 0.25.0 ([3f6a53c](https://github.com/wolfymaster/woofx3/commit/3f6a53c9563106603129c5e6c0e8f5b1bf687aa5))
* **modules:** make the segment filter optional and emit the cause ([bae0511](https://github.com/wolfymaster/woofx3/commit/bae05112d85207ed2c8e82be7b32be1c960173c4))
* **scene-editor:** validate through the type registry and sync behaviors ([05479f5](https://github.com/wolfymaster/woofx3/commit/05479f555038f150f89cfa99343a2746caeec1a6))
* **scene-manager:** a seekable composition preview page for the alert editor ([dfd5dc9](https://github.com/wolfymaster/woofx3/commit/dfd5dc967da78308ea7936adc6c5ab99b91c765e))
* **scene-manager:** persist behaviors, load inputs, never serve an alert ([9603c23](https://github.com/wolfymaster/woofx3/commit/9603c23afec96beabc44327b5001ba6807bcde53))
* **scene-manager:** refuse widget commands on an alert; migrate stored documents on load ([7433760](https://github.com/wolfymaster/woofx3/commit/7433760634e648dc3ab65a8de24c526da34ab81a))
* **scene:** add the @woofx3/scene package and its composition model ([f399f2f](https://github.com/wolfymaster/woofx3/commit/f399f2fc6ff2f83f16d019f2cf2d37fedc07f14f))
* **scene:** add the composition runtime ([b844c6f](https://github.com/wolfymaster/woofx3/commit/b844c6f6e29267906482328e2c79a815f6bb6a26))
* **scene:** add the headless composition editor ([159a770](https://github.com/wolfymaster/woofx3/commit/159a7704271feaa432a2848add4cc6930beadb8b))
* **sceneManager:** deliver every alert as a composition ([9881c52](https://github.com/wolfymaster/woofx3/commit/9881c529ae76b86d1eb2520ccdd6c4bb8f83ab2f))
* **sceneManager:** play scenes and alerts with the scene runtime ([2f5c2b2](https://github.com/wolfymaster/woofx3/commit/2f5c2b221524c95da51d5e4fa1085e0b30a12132))
* **scene:** the composition preview protocol ([d4999d3](https://github.com/wolfymaster/woofx3/commit/d4999d3694dd7156f67bf02eb26a1291a4c4c734))
* **widgets:** store the transition and effect kinds a widget declares ([596a125](https://github.com/wolfymaster/woofx3/commit/596a12525fc1cb134263a9fc11ef3a3bc9e9b41a))
* **woofx3:** the Text widget plays its own transitions; media widgets stay on screen ([831f56c](https://github.com/wolfymaster/woofx3/commit/831f56ca7bad3f20bc2cf9c5fa1f9673ca5a01e6))
* **workflow:** add lazy expression sources ([7f0aef0](https://github.com/wolfymaster/woofx3/commit/7f0aef008c3357126154b27d010da38b66289420))
* **workflow:** apply viewer fact deltas before dispatching workflows ([25e6bf3](https://github.com/wolfymaster/woofx3/commit/25e6bf33444793c7f319b19f9baeb24d25582a5f))
* **workflow:** evaluate an all/any/not condition tree over a data map ([f67b62b](https://github.com/wolfymaster/woofx3/commit/f67b62bdac58c582798d04ad85e4ae9dc2305ab3))
* **workflow:** expose the viewer's name as ${viewer.name} ([b1abdab](https://github.com/wolfymaster/woofx3/commit/b1abdabacd78e318469b8d5cc57e9b6775d5c726))
* **workflow:** let a lazy expression source fail to load ([df6edf1](https://github.com/wolfymaster/woofx3/commit/df6edf1ded5501dabeb5ddd425c65f221b5aebe1))
* **workflow:** project bus events onto per-viewer fact deltas ([1851353](https://github.com/wolfymaster/woofx3/commit/1851353f0e6155990859044caf65446380956e16))
* **workflow:** resolve ${viewer.*} in trigger conditions and steps ([b56f040](https://github.com/wolfymaster/woofx3/commit/b56f04032ee24681ef3a9bb85b363259f03e3bc8))

### Bug Fixes

* **db:** apply fact deltas in order, per delta, and against current revisions ([671ebdd](https://github.com/wolfymaster/woofx3/commit/671ebdd412184495c372614dbd6ee00be60ac784))
* **db:** give the viewer facts migration its 0057 id ([68945f1](https://github.com/wolfymaster/woofx3/commit/68945f11c1355c124f75dae1e2eb9d39eed98eb6))
* **db:** keep segment membership consistent under late events and revisions ([43c180e](https://github.com/wolfymaster/woofx3/commit/43c180e85f6be886ff201b8fa0d4676ff18f7ab9))
* **db:** number the viewer facts migration 0057 ([91fde5e](https://github.com/wolfymaster/woofx3/commit/91fde5efb34f0219f85d768d77bf1615a606ba61))
* **db:** number the viewer segments migration 0058 ([01a8d67](https://github.com/wolfymaster/woofx3/commit/01a8d677f590aa57c56ca27c708e92b15d47ea28))
* **db:** order segment locks against fact revisions ([c74c578](https://github.com/wolfymaster/woofx3/commit/c74c578c18738ae2adbbd96068d440ef58383f6c))
* **db:** refill frozen segments, and tighten segment saves and sessions ([4250297](https://github.com/wolfymaster/woofx3/commit/4250297ebd475cbdb900717670393290deb5629f))
* **db:** refuse a scene or alert name already taken, as AlreadyExists ([500f244](https://github.com/wolfymaster/woofx3/commit/500f24490786e9a3dd366964a91d2c94a285dd67))
* **db:** report a module workflow's stored enabled state after an upgrade ([88a84c5](https://github.com/wolfymaster/woofx3/commit/88a84c542b5b1372de48b312e65dc3c47fa86d4b))
* **db:** resolve facts against active triggers and report per-delta outcomes ([c1ea4fb](https://github.com/wolfymaster/woofx3/commit/c1ea4fb96dcc7a59639fe34b60144314119e3dcd))
* **db:** widen outbox entity ids to hold fact ids ([3a0d7d4](https://github.com/wolfymaster/woofx3/commit/3a0d7d4150e93cd0c46e6cc6d771a6400f2b538a))
* **scene-manager:** serve widget storage for placements the page holds but the stored row lacks ([3872d23](https://github.com/wolfymaster/woofx3/commit/3872d230b4a069751841b0641ca0c2ec8a88222a))
* **scene-manager:** update the composition preview in place, as the overlay does ([a81d493](https://github.com/wolfymaster/woofx3/commit/a81d493933a26433075ece98b12c949758e1090b))
* **scene:** resize media freely, with Shift to keep the aspect ([b9b5ae4](https://github.com/wolfymaster/woofx3/commit/b9b5ae47667c7bfe3378625e28c4af48a1d4aff5))
* **workflow:** fail ${viewer.*} trigger conditions closed and scope the viewer ([0e2461d](https://github.com/wolfymaster/woofx3/commit/0e2461df8f72fb9350de69919151474acdf3f0db))
* **workflow:** harden the fact write path and quiet facts-only events ([018fc58](https://github.com/wolfymaster/woofx3/commit/018fc588ed606257769cac203ee12befa1404876))
* **workflow:** reject a malformed condition value on a null field ([1bcf2c6](https://github.com/wolfymaster/woofx3/commit/1bcf2c678793dcc40daf5457774ec1a9d2174f41))
* **workflow:** run a workflow once per event when trigger patterns overlap ([1d94058](https://github.com/wolfymaster/woofx3/commit/1d94058d93f658f9f90654318a1438c4f71038b7))
* **workflow:** stop a null condition field comparing as text ([b464999](https://github.com/wolfymaster/woofx3/commit/b464999195deb9b9039eb8db61940c734925596c))
* **workflow:** tighten the fact projector's identity reading and hot path ([a4611f2](https://github.com/wolfymaster/woofx3/commit/a4611f2a02a57fcf199f48a3427099ee8ccfcb17))

## [0.28.0](https://github.com/wolfymaster/woofx3/compare/v0.27.0...v0.28.0) (2026-10-11)

### Features

* **fonts:** serve any Google Fonts family to widgets from the engine ([d30faab](https://github.com/wolfymaster/woofx3/commit/d30faab0dcfe5ba1492577c71ac2aec41bb72738))

## [0.27.0](https://github.com/wolfymaster/woofx3/compare/v0.26.0...v0.27.0) (2026-10-11)

### Features

* **api:** serve a stream session's events for its timeline ([7e98f52](https://github.com/wolfymaster/woofx3/commit/7e98f52653ba5a5ee35558b0fa03cdcfa358adc5))
* **barkloader:** ctx.resources.compareAndSetSetting for instance settings ([8552dd1](https://github.com/wolfymaster/woofx3/commit/8552dd15de3cc821406834dc723ffed970ac7b44))
* **barkloader:** file actions in the picker by their first taxonomy entry ([41018c6](https://github.com/wolfymaster/woofx3/commit/41018c6809b1b43d528ffbde52a71798f9b359b1))
* **db:** list a stream session's counted user events in time order ([231d5b1](https://github.com/wolfymaster/woofx3/commit/231d5b1850304471598677118500fcc29ae919fe))

### Bug Fixes

* **db:** address resource instances by their module's manifest id ([0aa2902](https://github.com/wolfymaster/woofx3/commit/0aa2902f5c05dd2482a6007ceb28dc5f4120f9e5))

## [0.26.0](https://github.com/wolfymaster/woofx3/compare/v0.25.0...v0.26.0) (2026-10-10)

### Features

* **modules:** drop the highlight color from the Text, Counter and Timer widgets ([0f9a896](https://github.com/wolfymaster/woofx3/commit/0f9a896df753681eb1c4fbfe0fe34a4c7f8c4f64))
* **sceneManager:** scene editor protocol 2 on the shared sequencer ([056d181](https://github.com/wolfymaster/woofx3/commit/056d181053f3f8c0d74cd0bfde7331ac2b1efcdd))

## [0.25.0](https://github.com/wolfymaster/woofx3/compare/v0.24.0...v0.25.0) (2026-10-10)

### Features

* **db:** persist scene editor sync state ([b9d9460](https://github.com/wolfymaster/woofx3/commit/b9d946042832a2a70c9b90a857425cec71d77513))

### Bug Fixes

* **db:** keep scene editor state consistent with its documents ([d066f90](https://github.com/wolfymaster/woofx3/commit/d066f908d90aae00e5efc3752545f2e6000b0096))
* **db:** store scene editor state as validated text, clearable on purpose ([9305434](https://github.com/wolfymaster/woofx3/commit/9305434747dcf47987e336fcb5cb33103f5289a3))

## [0.24.0](https://github.com/wolfymaster/woofx3/compare/v0.23.0...v0.24.0) (2026-10-10)

### Features

* **api:** scene editor sync core: protocol, sequencer and client ([9704286](https://github.com/wolfymaster/woofx3/commit/9704286d35726e49cde1da7ea2e729707a8b673f))

### Bug Fixes

* **api:** commit an engine change that only changes placement meta ([f674005](https://github.com/wolfymaster/woofx3/commit/f67400564f48f731a403568e09c5c3c6264fb5e3))
* **api:** harden the scene editor sync core ([f541891](https://github.com/wolfymaster/woofx3/commit/f5418914f0b82a536466286261b7306463706e01))
* **api:** move pending edits onto a snapshot as whole-field replacements ([5395d6f](https://github.com/wolfymaster/woofx3/commit/5395d6fc4f7452b86e420d543fdad94d6a6fdf7c))

## [0.23.0](https://github.com/wolfymaster/woofx3/compare/v0.22.0...v0.23.0) (2026-10-10)

### Features

* **barkloader:** media proxy for external media in widget settings ([58e2c23](https://github.com/wolfymaster/woofx3/commit/58e2c23d588200384876687cff043acd9a538a9f))

### Bug Fixes

* **barkloader:** bound media proxy relays per upstream URL and never cache non-file answers ([d4d8c68](https://github.com/wolfymaster/woofx3/commit/d4d8c682f8d18ee905908d2255d2810d7429ebf5))
* **barkloader:** expire media proxy tokens, fetch http upstreams, and refuse more special-use IPv6 ([77ab12d](https://github.com/wolfymaster/woofx3/commit/77ab12db11cf566d047e5025d8191905c5c14392))
* **barkloader:** release a relay's unused bytes without the deprecated fetch_update ([7622351](https://github.com/wolfymaster/woofx3/commit/7622351fad8bc4ce10e6c786ac338c3ac376e03d))
* **barkloader:** reserve media relay budget up front and cap concurrent relays ([8e53357](https://github.com/wolfymaster/woofx3/commit/8e53357c3345bdc3b68883185cc51734a712e432))
* **sceneManager:** bound frame lookups, sign only editor-chosen alert media, retry media refresh ([b11a7e2](https://github.com/wolfymaster/woofx3/commit/b11a7e29b9175e105c934762efd464d6035e6edb))
* **sceneManager:** derive overlay media in one place, reframe unavailable placements, shorten proxy tokens ([1a5d36c](https://github.com/wolfymaster/woofx3/commit/1a5d36c77ff8d3f34c3a3bd31f2d4bd060364c46))
* **sceneManager:** proxy every user-entered alert media URL for themeable widgets ([5d0039f](https://github.com/wolfymaster/woofx3/commit/5d0039f3365f16bc2117f0ef1338169d2fe76327))
* **sceneManager:** proxy external media only for themeable widgets, sign drafts only for editors ([a0a1c5a](https://github.com/wolfymaster/woofx3/commit/a0a1c5a7951a7a69c7c60084e194d417e9f51bbf))
* **sceneManager:** serve external placement media through the engine media proxy ([ce870dc](https://github.com/wolfymaster/woofx3/commit/ce870dc679fa8fe7d65816242155e751630a3ec6))

## [0.22.0](https://github.com/wolfymaster/woofx3/compare/v0.21.1...v0.22.0) (2026-10-09)

### Features

* **barkloader:** let a resource kind say where its value's summary is ([1b65fd9](https://github.com/wolfymaster/woofx3/commit/1b65fd97786f6ec97ef0565afcd8b5f276758f4d))
* **sceneManager:** serve a resource instance whole and stop reading kinds ([ecf20ed](https://github.com/wolfymaster/woofx3/commit/ecf20ed49caf1dd00c151de81e8a4366ad1766ed))

## [0.21.1](https://github.com/wolfymaster/woofx3/compare/v0.21.0...v0.21.1) (2026-10-09)

### Bug Fixes

* **alerts:** completed replaces any verdict, transactional outbox, every row of an envelope ([fc06474](https://github.com/wolfymaster/woofx3/commit/fc064746d8e6d93aa89584a561a7df133f1deaa0))
* **alerts:** first verdict wins, one clock per write, unversioned snapshots still sent ([af0bcbe](https://github.com/wolfymaster/woofx3/commit/af0bcbe67099a0ff627a016d2fea99e38f2c013c))
* **alerts:** forward-only lifecycle with a per-alert version ([52c6efa](https://github.com/wolfymaster/woofx3/commit/52c6efa2ad086ae6872dcb2295afedf71e279cba))
* **alerts:** move only an envelope's newest row, in one conditional UPDATE ([02824b6](https://github.com/wolfymaster/woofx3/commit/02824b691b59e3bbaaea0419aca2584e5fc1d189))
* **alerts:** report each play's lifecycle against its own row ([63c401e](https://github.com/wolfymaster/woofx3/commit/63c401efe7c4d6733366aa7d978fb317b574fea9))
* **alerts:** send dispatched and playing callbacks, and updated_at at full precision ([cc0cc26](https://github.com/wolfymaster/woofx3/commit/cc0cc2622e0fc0e493c065d81065b455ff3503aa))
* **api:** read an alert version written as its decimal string ([83b0ada](https://github.com/wolfymaster/woofx3/commit/83b0adab77491630060f6d037340d5ca47e8e6ba))
* **api:** type-check the alert updated callback per status; document dispatched ([e40b1f3](https://github.com/wolfymaster/woofx3/commit/e40b1f3a4ce814f76caacc792034d36cfcb0e459))
* **db:** let the alert timestamp migration skip values it cannot parse ([1cc67e3](https://github.com/wolfymaster/woofx3/commit/1cc67e381598604813723f36e78c82f573eb87a4))

## [0.21.0](https://github.com/wolfymaster/woofx3/compare/v0.20.0...v0.21.0) (2026-10-09)

### Features

* **barkloader:** identify resource kinds by module and kind ([854fb19](https://github.com/wolfymaster/woofx3/commit/854fb1970aaf1023672389840c48beba55469fc7))

## [0.20.0](https://github.com/wolfymaster/woofx3/compare/v0.19.1...v0.20.0) (2026-10-09)

### Features

* **api:** reject a list module setting value that isn't rows ([3110cd8](https://github.com/wolfymaster/woofx3/commit/3110cd899b908c15ea18673376b5660378ebe66d))
* **barkloader:** list module settings and ctx.module.compareAndSetSetting ([3e32dc2](https://github.com/wolfymaster/woofx3/commit/3e32dc2b3c9e079127422162989fe03e90f7e61a))
* **db:** compare-and-set for module settings ([fc594c8](https://github.com/wolfymaster/woofx3/commit/fc594c86579efd6183632a1f3b57d12d44a626e4))
* **sceneManager:** serve a module's list settings to its widgets ([0783768](https://github.com/wolfymaster/woofx3/commit/07837687eeee889cdcbd3c3f7a17ecdc9353dbb3))

## [0.19.1](https://github.com/wolfymaster/woofx3/compare/v0.19.0...v0.19.1) (2026-10-08)

### Bug Fixes

* **sceneManager:** let themeable widget frames load images and media from any http(s) host ([d32510f](https://github.com/wolfymaster/woofx3/commit/d32510f57eebac743ef9e17688a38fc2d94f7ce8))
* **sceneManager:** record an alert as completed when its overlay finishes it ([0441670](https://github.com/wolfymaster/woofx3/commit/0441670106ba08c843c3644efffc70dbc43c0b82))

## [0.19.0](https://github.com/wolfymaster/woofx3/compare/v0.18.0...v0.19.0) (2026-10-08)

### Features

* **api:** list and read the files inside an installed module ([174cbc5](https://github.com/wolfymaster/woofx3/commit/174cbc55ffbecfa17bbe76129c13784e4f102368))
* **barkloader:** list and read the files inside a module's install archive ([2c3d0ab](https://github.com/wolfymaster/woofx3/commit/2c3d0ab2c544ad1341a21a75b68758f9d83174f1))

## [0.18.0](https://github.com/wolfymaster/woofx3/compare/v0.17.0...v0.18.0) (2026-10-08)

### Features

* **barkloader:** keep a module OAuth token to the endpoints it was issued for ([2368066](https://github.com/wolfymaster/woofx3/commit/2368066a047416f2743a3368a8bd1a234416cc5f))
* **barkloader:** refuse a dashboard-supplied OAuth client at another token endpoint ([07a8f12](https://github.com/wolfymaster/woofx3/commit/07a8f121c7adee6c0975a50a7b539a0852857823))

### Bug Fixes

* **scenes:** store widget opacity as a fraction 0–1, migrating stored percents ([9caf518](https://github.com/wolfymaster/woofx3/commit/9caf5183666802fd3a6518b08fa6d3db4c9b88fa))

## [0.17.0](https://github.com/wolfymaster/woofx3/compare/v0.16.0...v0.17.0) (2026-10-08)

### Features

* **obs:** let modules show a web page in a browser source ([0c4c128](https://github.com/wolfymaster/woofx3/commit/0c4c12893cdab934432f13438c8bd6378fbb2d8d))

## [0.16.0](https://github.com/wolfymaster/woofx3/compare/v0.15.0...v0.16.0) (2026-10-07)

### Features

* **api:** hand the dashboard a scene editor session ([478a03c](https://github.com/wolfymaster/woofx3/commit/478a03cc1e61ac0e8e26c4027977d421d5ba6178))
* **db:** keep a scene's draft beside its published widgets and layout ([c42fec0](https://github.com/wolfymaster/woofx3/commit/c42fec09929e8119f99acd313b39cdf18de71ed1))
* **sceneManager:** acknowledge a resubmitted op instead of applying it twice ([457968e](https://github.com/wolfymaster/woofx3/commit/457968efef30a90655c1acf99b7b42553865e90d))
* **sceneManager:** an editor socket, opened with a short-lived editor token ([d33d985](https://github.com/wolfymaster/woofx3/commit/d33d985e1bf6249a9bcc409aa49a7b913d38d4bc))
* **sceneManager:** carry every stored placement field through the scene document ([7903f32](https://github.com/wolfymaster/woofx3/commit/7903f3260e883926c303e242a34f8f3dbd7b2f79))
* **sceneManager:** relay which widget each scene editor has selected ([da4a6c6](https://github.com/wolfymaster/woofx3/commit/da4a6c618f3f4d5b9b528d1d771bfbc5751222b7))
* **sceneManager:** sequence editors' ops against a draft and the published scene ([0d99b61](https://github.com/wolfymaster/woofx3/commit/0d99b6195bf6e38a1df876d1e150db753835dc42))
* show or hide a scene widget from a workflow, saved with the scene ([920c33c](https://github.com/wolfymaster/woofx3/commit/920c33c6d6ac2992bfbd2a3ce898f067546a5197)), closes [#220](https://github.com/wolfymaster/woofx3/issues/220)

## [0.15.0](https://github.com/wolfymaster/woofx3/compare/v0.14.0...v0.15.0) (2026-10-07)

### Features

* **sceneManager:** push scene saves to overlays as sequenced json0 ops ([bc83309](https://github.com/wolfymaster/woofx3/commit/bc833098dbf7f78fe1dae7b2d94b70895eb4e9fa))

## [0.14.0](https://github.com/wolfymaster/woofx3/compare/v0.13.0...v0.14.0) (2026-10-07)

### Features

* **barkloader:** serve widget frames from an in-memory cache ([a5104dd](https://github.com/wolfymaster/woofx3/commit/a5104ddbb21f64d1a800bdcfaae9473810e1ca18))
* **module-sdk:** setting bindings, read tracking and a cacheable boot ([10e6533](https://github.com/wolfymaster/woofx3/commit/10e6533e2e9a7dc3490a3a9b4a054a1fb6a76d0d)), closes [#219](https://github.com/wolfymaster/woofx3/issues/219)
* **modules:** show text and image settings through bindings, and drop onSettings ([709a56c](https://github.com/wolfymaster/woofx3/commit/709a56c45e80cea1ec7f45eccced6d0fdf932d1d)), closes [#219](https://github.com/wolfymaster/woofx3/issues/219)
* **sceneManager:** cacheable frames, and settings patched or swapped in ([626bf2c](https://github.com/wolfymaster/woofx3/commit/626bf2c0e77245e5ba754bd0fcd9c07e301649a9))

## [0.13.0](https://github.com/wolfymaster/woofx3/compare/v0.12.0...v0.13.0) (2026-10-07)

### Features

* **api:** store the relay configuration and renew the bridge credential through the dashboard ([56d28b8](https://github.com/wolfymaster/woofx3/commit/56d28b807d1a47c5b20852aa1848f029b03e5c55))
* **barkloader:** local[] endpoints in the module manifest ([9465fe2](https://github.com/wolfymaster/woofx3/commit/9465fe2fb5eb57be34a7cef4741db716e3763f14))
* **sceneManager:** reach OBS through an endpoint dialer that can use the companion's bridge ([3687702](https://github.com/wolfymaster/woofx3/commit/3687702f48bbbac878cf0e684fc03951edc4dbf5))

## [0.12.0](https://github.com/wolfymaster/woofx3/compare/v0.11.1...v0.12.0) (2026-10-04)

### Features

* **modules:** redraw the text, image, counter and timer widgets on a settings change ([2f929aa](https://github.com/wolfymaster/woofx3/commit/2f929aaafdad180ffd812a61856b489afa8ae553))
* **sceneManager:** hand a widget its settings as they're edited ([3006319](https://github.com/wolfymaster/woofx3/commit/300631966b1f233b22ac752e3511e258b34b186e))

## [0.11.1](https://github.com/wolfymaster/woofx3/compare/v0.11.0...v0.11.1) (2026-10-04)

### Bug Fixes

* **logging:** one log record per line in production ([290cf9b](https://github.com/wolfymaster/woofx3/commit/290cf9b16080eb6d6f799cacc334b579ed673a99))
* **sceneManager:** give each scene its own session cookie ([03b8131](https://github.com/wolfymaster/woofx3/commit/03b813158da52d70113ea31255b07b95471439af))
* **twitch:** subscribe to channel.hype_train.begin v2 ([c8435fa](https://github.com/wolfymaster/woofx3/commit/c8435fa2a563b1499a4d874894730ce55dabe5ae))

## [0.11.0](https://github.com/wolfymaster/woofx3/compare/v0.10.1...v0.11.0) (2026-10-04)

### Features

* **barkloader:** let a module setting link a resource instance at install ([73848e7](https://github.com/wolfymaster/woofx3/commit/73848e7a47e470360afab2570396f25bcfde66ff))
* **barkloader:** let module code run an action on a resource it was given ([2113fa6](https://github.com/wolfymaster/woofx3/commit/2113fa6ca23959d56a15dd9f10a74cce9533ee1f))
* **modules:** let a timer hold more than a day ([15dfe41](https://github.com/wolfymaster/woofx3/commit/15dfe413c9d4ba41db7e6c852e284175c2d48d62))
* **modules:** read a timer without changing it ([1689330](https://github.com/wolfymaster/woofx3/commit/1689330d16e79224d876ce7fa221ea992be9a41f))
* **sceneManager:** apply a scene save in place instead of reloading the overlay ([1b58b74](https://github.com/wolfymaster/woofx3/commit/1b58b740e07f9354bb14088f0b4f042c06f72c26))
* **sceneManager:** let a widget show a resource its module links ([9b771a6](https://github.com/wolfymaster/woofx3/commit/9b771a6775280fceafe7350a5abc8236871f833a))
* **sceneManager:** preview a scene editor's unsaved widgets and settings ([ba274e8](https://github.com/wolfymaster/woofx3/commit/ba274e8213fa7c5c1c85f23a1d18ce56870f8de8))
* **twitch:** let modules look up a Twitch user with ctx.twitch.getUser ([6149034](https://github.com/wolfymaster/woofx3/commit/614903480f3a6219ead5084d6e613c93f59afb80))
* **twitch:** queue every shoutout on the dashboard's shoutout queue ([8a999a4](https://github.com/wolfymaster/woofx3/commit/8a999a4e4f6dc3cfb551daafb05dd121fc61ecb7))

## [0.10.1](https://github.com/wolfymaster/woofx3/compare/v0.10.0...v0.10.1) (2026-10-04)

### Bug Fixes

* **db:** create a module's bundled workflows enabled ([4647097](https://github.com/wolfymaster/woofx3/commit/464709765f8622c4d4bf304cd1d489992b09c325))

## [0.10.0](https://github.com/wolfymaster/woofx3/compare/v0.9.2...v0.10.0) (2026-10-02)

### Features

* **barkloader:** let a number trigger field offer a choice of comparison ([5723ec5](https://github.com/wolfymaster/woofx3/commit/5723ec567e9f58155cfb4aabece0ee9ae0f481f3))

## [0.9.2](https://github.com/wolfymaster/woofx3/compare/v0.9.1...v0.9.2) (2026-10-02)

### Bug Fixes

* **sceneManager:** paint the scene's background colour in the overlay ([dffda41](https://github.com/wolfymaster/woofx3/commit/dffda416d647aa62d33ad1e9b01a96daab4efbb2))

## [0.9.1](https://github.com/wolfymaster/woofx3/compare/v0.9.0...v0.9.1) (2026-10-02)

### Bug Fixes

* **edge:** route /health to the api instead of sceneManager ([6c85760](https://github.com/wolfymaster/woofx3/commit/6c85760f13ce7a1f325c2ca3770ce7c07164f5e4))

## [0.9.0](https://github.com/wolfymaster/woofx3/compare/v0.8.0...v0.9.0) (2026-10-02)

### Features

* **barkloader:** ctx.oauth, OAuth for modules without holding the tokens ([896b8c6](https://github.com/wolfymaster/woofx3/commit/896b8c68193ee539acb5448d0248608e7fba460a))

### Bug Fixes

* **webhooks:** refuse a handler answer that is a page ([ba170b5](https://github.com/wolfymaster/woofx3/commit/ba170b5338509105b857d5cb4feea858a0dfec4f))

## [0.8.0](https://github.com/wolfymaster/woofx3/compare/v0.7.0...v0.8.0) (2026-10-02)

### Features

* **barkloader:** limit ctx.http to destinations the streamer approved ([2236de8](https://github.com/wolfymaster/woofx3/commit/2236de832b7a38b55e06d76c5669a4c537235ea2))
* **capabilities:** report that Twitch tokens are renewed through the dashboard ([460f8ce](https://github.com/wolfymaster/woofx3/commit/460f8ce60166ea808d20799642b506df5c10826b))

## [0.7.0](https://github.com/wolfymaster/woofx3/compare/v0.6.2...v0.7.0) (2026-10-02)

### Features

* **api:** describe the engine on GET /health ([07b92ab](https://github.com/wolfymaster/woofx3/commit/07b92abac89ed6fb6a961abc0ae702feeda39f3e))
* **twitch:** renew a dashboard's Twitch token through the dashboard ([9c01390](https://github.com/wolfymaster/woofx3/commit/9c013907aa0ed8ae2419b56ea4e6144f7b092d70))

### Bug Fixes

* **barkloader:** give module code no access to the engine's environment ([42efeea](https://github.com/wolfymaster/woofx3/commit/42efeeae294870890ce8943e5c4fb4f051688371))

## [0.6.2](https://github.com/wolfymaster/woofx3/compare/v0.6.1...v0.6.2) (2026-10-01)

### Bug Fixes

* **twitch:** read the ad-break lead time from the Twitch module's settings ([f999d6a](https://github.com/wolfymaster/woofx3/commit/f999d6a1f85c4d86eccf552fb21ff392555d3218))

## [0.6.1](https://github.com/wolfymaster/woofx3/compare/v0.6.0...v0.6.1) (2026-10-01)

### Bug Fixes

* **release:** check the release against the built commit, not HEAD ([f265d3b](https://github.com/wolfymaster/woofx3/commit/f265d3b5c7da441b542bb22dbdd32e74e31c0903))

## [0.6.0](https://github.com/wolfymaster/woofx3/compare/v0.5.0...v0.6.0) (2026-09-30)

### Features

* **db:** announce module setting writes on the outbox ([deaac5d](https://github.com/wolfymaster/woofx3/commit/deaac5de61c56aab766b2d0f68b97d389f20752b))
* report the OBS connection state through getObsStatus ([cf940cd](https://github.com/wolfymaster/woofx3/commit/cf940cdb7926644cea455fa6306e61a43e5b4e82))
* **sceneManager:** connect to OBS with the OBS module's settings ([6627efa](https://github.com/wolfymaster/woofx3/commit/6627efab37141cf7a1b940b040e4e0d9ea5a2326))

### Bug Fixes

* **orchestrator:** stop db-proxy and the message bus after the services that use them ([6c20a11](https://github.com/wolfymaster/woofx3/commit/6c20a114088bad74545e7f25b900c3aa7ebc3e44))
* **workflow:** record runs the engine abandons when it stops ([2e982f7](https://github.com/wolfymaster/woofx3/commit/2e982f7565d7b7ac82bc085ccfe9e9e6fbc05160))

## [0.5.0](https://github.com/wolfymaster/woofx3/compare/v0.4.0...v0.5.0) (2026-09-30)

### Features

* **resources:** thumbnail videos from a client-captured poster ([6270e56](https://github.com/wolfymaster/woofx3/commit/6270e564d940fbff92ec9e80dab544533bafd568))

### Bug Fixes

* **barkloader:** extract module zips in-process ([61dc395](https://github.com/wolfymaster/woofx3/commit/61dc39541a2813572ff21397b6b8fd3e46d1f802))

## [0.4.0](https://github.com/wolfymaster/woofx3/compare/v0.3.0...v0.4.0) (2026-09-30)

### Features

* **api:** accept and validate delay waits in workflow definitions ([93d2411](https://github.com/wolfymaster/woofx3/commit/93d24112f70dfc20d75d20f88aa1d205f4801489))
* **api:** ad schedule RPCs and ad-break heads-up events ([8f48537](https://github.com/wolfymaster/woofx3/commit/8f48537e38635b4ad915dc2d253583bd67085a07))
* **api:** advertise config.bundles engine capability ([f66d666](https://github.com/wolfymaster/woofx3/commit/f66d666e57c72d7a03b96c5be08d6c9ccab7f50d))
* **api:** export, preview and import a creator's configuration ([5c3a8e1](https://github.com/wolfymaster/woofx3/commit/5c3a8e187b7564f7e1605282a8f1d73024807f9b))
* **api:** expose stream info, markers and category search to the UI ([9004eb0](https://github.com/wolfymaster/woofx3/commit/9004eb05a1c97f042b4ffbeca04ec57a527978f5))
* **api:** forward workflow health and serve getWorkflowHealth ([2febde3](https://github.com/wolfymaster/woofx3/commit/2febde3d501894f507c3176a4820523d9a5c6c78))
* **api:** getEngineCapabilities for feature detection by the UI ([314890f](https://github.com/wolfymaster/woofx3/commit/314890f211dc0cddd03c118bdb49839a739b75f2))
* **api:** listObsScenes, and refuse obs.* steps missing required parameters ([7efe7b4](https://github.com/wolfymaster/woofx3/commit/7efe7b433ef315f73468064e385120b071ae929c))
* **api:** obs.control capability, and document OBS through ctx.obs ([74eaa0c](https://github.com/wolfymaster/woofx3/commit/74eaa0ccd4267625300774a862157e315818417a))
* **api:** relay a field-options { error } reply as a failed request ([6301ca5](https://github.com/wolfymaster/woofx3/commit/6301ca56a9cc2c5abd91fe84d83b47e733c9df78))
* **api:** request a dry run of a workflow ([d66a2a2](https://github.com/wolfymaster/woofx3/commit/d66a2a25d169f4ccdf9c7f05a5a065b8adf470ad))
* **api:** trigger a workflow with sample data and cancel runs through the engine ([5cc07e2](https://github.com/wolfymaster/woofx3/commit/5cc07e2939b338f1a1f12ff17bae0cb89c780578))
* **barkloader:** ctx.obs, so a module can change OBS and list its names ([0040f94](https://github.com/wolfymaster/woofx3/commit/0040f947c45cee7c818527fe170eb4572806d675))
* **barkloader:** systemOnly actions an uploaded module cannot reference ([d4aba76](https://github.com/wolfymaster/woofx3/commit/d4aba763124b18c8cd53a6a30eac13757dc7098e))
* **db:** mark dry-run workflow runs in the run history ([c2838d9](https://github.com/wolfymaster/woofx3/commit/c2838d95b4765ec26c0ada125299c9bb2558d00e))
* **module-sdk:** type ctx.obs ([be9424c](https://github.com/wolfymaster/woofx3/commit/be9424ccedabbb33fd4d9d6207ed67716bb30a83))
* **modules:** declare the obs.* native actions in the woofx3 module ([f390893](https://github.com/wolfymaster/woofx3/commit/f390893729d7115d5bbb2fea060ef687e1afc428))
* **modules:** offer OBS names on the obs.* action fields ([3dda69f](https://github.com/wolfymaster/woofx3/commit/3dda69f33c0863918d534437e40fc884ca8f768d))
* **sandbox:** add ctx.twitch.createMarker ([d94a54a](https://github.com/wolfymaster/woofx3/commit/d94a54afb17ff5749cbbdae143fb448138053c69))
* **sandbox:** answer ctx.twitch calls and gate timeout and updateStream on manifest permissions ([3f9b634](https://github.com/wolfymaster/woofx3/commit/3f9b634cf5fbf66063a5455729b78192c0a2046c))
* **scene-manager:** carry engine.obs.command requests to OBS ([c7081ab](https://github.com/wolfymaster/woofx3/commit/c7081ab7621a7d0acde3f87f989fe109fd5040dc))
* **scene-manager:** list OBS scenes, sources and inputs on engine.obs.options ([00d20ef](https://github.com/wolfymaster/woofx3/commit/00d20ef59fddc59434a840aa4bc5746fc5d6ae95))
* **scene-manager:** reconnect to OBS with capped exponential backoff ([6a0cf46](https://github.com/wolfymaster/woofx3/commit/6a0cf466a2467babec3dc3fbf521b8cb77dbbeed))
* **twitch:** announce upcoming ad breaks from the twitch service ([d7a0847](https://github.com/wolfymaster/woofx3/commit/d7a0847529df554d4ae1ecb5c500f414620e1d6f))
* **twitch:** publish ad-break events and read the ad schedule ([88994e0](https://github.com/wolfymaster/woofx3/commit/88994e0ea9dc15901a74e17bfc71e77018cf4205))
* **twitch:** report the shoutout rate limit with a rate_limited code ([450c02b](https://github.com/wolfymaster/woofx3/commit/450c02b1cdb1798fa7f35751408b679461d3b55d))
* **twitch:** time out chatters, update stream info, place markers, search categories ([609a2ba](https://github.com/wolfymaster/woofx3/commit/609a2bab095a648dc111ae5ff5bb2832b13ad8f7))
* **woofwoofwoof:** let broadcaster and mods set title, category and markers from chat ([f5a8547](https://github.com/wolfymaster/woofx3/commit/f5a85471272bb9d41f434ae51ab84feb66d5d23c))
* **workflow:** default obs.* booleans to true and pair each action with its validator ([0712db6](https://github.com/wolfymaster/woofx3/commit/0712db65fabcfdbd28ffeeb846daf576c4d7ec7f))
* **workflow:** dry runs that describe side effects instead of doing them ([79456fb](https://github.com/wolfymaster/woofx3/commit/79456fb032211ff03a4b9dd1b068ce080644fcd4))
* **workflow:** end waits on a timer and add a delay wait ([0c402ce](https://github.com/wolfymaster/woofx3/commit/0c402ce77ef9045552bfff1ae4abed723385e52f))
* **workflow:** native Twitch actions for shoutout, clip, marker, stream info and timeout ([48f704f](https://github.com/wolfymaster/woofx3/commit/48f704fed8846ca96f73ed0a85d3278b40654404))
* **workflow:** obs.* actions that switch scenes, toggle sources and mute inputs ([3235d36](https://github.com/wolfymaster/woofx3/commit/3235d36f03934b60bd736e1d5313d1247dacb478))
* **workflow:** report trigger registration failures as workflow health ([ef350fe](https://github.com/wolfymaster/woofx3/commit/ef350fe6aa38fbc653b0823d69ede8b6387e8be3))
* **workflow:** run one workflow with sample trigger data, and cancel runs for real ([e76a1dd](https://github.com/wolfymaster/woofx3/commit/e76a1dd40443ce56e92c6f237580c65378b371df))
* **workflow:** snapshot health at start-up, retry trigger refusals, serialize loads ([08adcc1](https://github.com/wolfymaster/woofx3/commit/08adcc16caf83712b0b6f0ca32772bc84eb0e0ed))
* **workflow:** track and publish workflow health ([f94a95b](https://github.com/wolfymaster/woofx3/commit/f94a95b4f3c207c1e13b4cf825e0e76bc749f5db))
* **workflow:** validate action parameters when a workflow is registered ([d58ce10](https://github.com/wolfymaster/woofx3/commit/d58ce10cd524f9d3d5282a1466336fbd4cea5fce))

### Bug Fixes

* **api:** derive privileged import actions from module manifests ([ce02297](https://github.com/wolfymaster/woofx3/commit/ce02297e5576b64a9759e940e33a193919d22a44))
* **api:** dispatch field option requests by field reference ([ca97cd9](https://github.com/wolfymaster/woofx3/commit/ca97cd95eae845d9116b50aab9d3909d003d96b1))
* **api:** make config import follow renamed and failed dependencies ([b2d9656](https://github.com/wolfymaster/woofx3/commit/b2d965669d81a7edbdf0e46d7a34eb257d3cbe59))
* **api:** refuse a workflow that publishes a reserved subject when it is saved ([56d3da8](https://github.com/wolfymaster/woofx3/commit/56d3da81bff9d708d2c30eb739dc08ae09513593))
* **api:** resolve field references from one module and refuse disabled ones ([550276d](https://github.com/wolfymaster/woofx3/commit/550276db5a424d35fe97d31fe58adf5810426c95))
* **api:** return the scene manager's answer to alert queue controls ([4720f94](https://github.com/wolfymaster/woofx3/commit/4720f9444c834f0db05794b1687a093a1f5f6fc3))
* **api:** validate wait timeouts with Go's duration grammar and accept cleared fields ([e916b8a](https://github.com/wolfymaster/woofx3/commit/e916b8ab368ff604725aedb64cd169fe782b581b))
* **db:** never move a workflow run out of a terminal status ([5be15b8](https://github.com/wolfymaster/woofx3/commit/5be15b8280f1d3cd474eae266269e924a70298e4))
* **modules:** allowlist the requests an uploaded module's forms may send ([a615dcb](https://github.com/wolfymaster/woofx3/commit/a615dcb5a57b1880e9cf8da6dc54a9011727c174))
* **modules:** keep uploaded modules off the engine's command subjects ([4626815](https://github.com/wolfymaster/woofx3/commit/462681561b65c581d2350becba3a7ee0c562ff82))
* **modules:** keep uploaded modules off workflow.cancel ([182aa55](https://github.com/wolfymaster/woofx3/commit/182aa558b1736eabff14e61da359bf72b9192178))
* **modules:** keep uploaded modules' form requests off command subjects ([d41574f](https://github.com/wolfymaster/woofx3/commit/d41574f88ac56f6e2893656d3f91d8d9101f024b))
* **modules:** require a module's permissions to call its actions across modules ([e08728a](https://github.com/wolfymaster/woofx3/commit/e08728ae19e7b8f163547ad33da3515362387604))
* **nats:** guard the Go client's connection and keep a reconnecting one ([4f96ee4](https://github.com/wolfymaster/woofx3/commit/4f96ee433548361e338a3affe8f5b5d477094d51))
* **release:** anchor stream session segment test to the wall clock ([4727752](https://github.com/wolfymaster/woofx3/commit/4727752a1001a86064e56aeec6ccd93675093f2f))
* **sandbox:** bound ctx.twitch calls by the invocation deadline and in-flight limits ([9718fae](https://github.com/wolfymaster/woofx3/commit/9718fae206583727bb0293aa69932eca4d4820ba))
* **sandbox:** limit ctx.twitch to clip, shoutout and createMarker ([53a439c](https://github.com/wolfymaster/woofx3/commit/53a439c99b77cef334f894e7d9e0b2ad6176dcf7))
* **scene-manager:** harden OBS control against strays, hangs and groups ([7020afc](https://github.com/wolfymaster/woofx3/commit/7020afc7e2bdce19142ba508fcef4a7f06258740))
* **sceneManager:** answer alert skip, clear and replay requests ([58e2828](https://github.com/wolfymaster/woofx3/commit/58e282880ad9f2d3435209995e6599079a2666d5))
* **sceneManager:** find the playing alert from page reports and cancel in one pass ([156efb9](https://github.com/wolfymaster/woofx3/commit/156efb9374c18df195436abc74ec9d117d9de5e2))
* **twitch:** apply a relinked token without a restart ([c4b3b04](https://github.com/wolfymaster/woofx3/commit/c4b3b04a97c49b29f6790ef364100a524f77eab0))
* **twitch:** count title length in characters, accept combining marks in tags, cap timeout reasons ([ba2325e](https://github.com/wolfymaster/woofx3/commit/ba2325eb963c7a7bdce0afffe3dc01e9ce3481b7))
* **twitch:** harden ad-break begin handling ([459901a](https://github.com/wolfymaster/woofx3/commit/459901a3deda48ef35b7926a64fcce2722b5ba57))
* **twitch:** never grant broadcaster or moderator to a shared-chat partner's message ([ce3feb0](https://github.com/wolfymaster/woofx3/commit/ce3feb0f63e2ed784f090a50389d25ea9c3c0560))
* **woofwoofwoof:** time out !vanish by chatter id and report Twitch failures plainly ([11fc9a3](https://github.com/wolfymaster/woofx3/commit/11fc9a380b5a2fb9bcd7c3e0ceda84d5f51bccb8))
* **workflow:** a dry run's lifecycle starts dependent workflows as dry runs ([85e3485](https://github.com/wolfymaster/woofx3/commit/85e3485665be6442d656f774f0157bb5db38f9f1))
* **workflow:** check twitch.* parameters on save and refuse unresolved templates ([004086a](https://github.com/wolfymaster/woofx3/commit/004086aecca67a18c97c47be14c83e1dacdf7986))
* **workflow:** keep untimed waits indefinite and refuse arming after Stop ([bf8407e](https://github.com/wolfymaster/woofx3/commit/bf8407e648f396e20512d1757cc3751112734d34))
* **workflow:** make wait aggregation count the right number and time out ([5cd4d04](https://github.com/wolfymaster/woofx3/commit/5cd4d042066fbf93a651468ffa726dc266d14ea8))
* **workflow:** refuse publish_event on subjects reserved for the engine ([925fe10](https://github.com/wolfymaster/woofx3/commit/925fe1034a31008ecfbe1ba8413bb9b1bd3e1a7d))
* **workflow:** refuse reserved publish subjects on every registration path ([466eb0c](https://github.com/wolfymaster/woofx3/commit/466eb0c3cb4677c0887d21bd3a3335b06eea0d79))
* **workflow:** reserve workflow.cancel, match exact names exactly, and fail closed ([897e869](https://github.com/wolfymaster/woofx3/commit/897e8698757e23b3b3fd6cf5855a794b9e6705fb))
* **workflow:** unregister the previous version when the validator refuses an update ([7db2fea](https://github.com/wolfymaster/woofx3/commit/7db2fea28bec32290fb3ee31f2adb01076023ec1))
