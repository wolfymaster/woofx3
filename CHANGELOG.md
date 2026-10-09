# Changelog

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
