# [1.3.0](https://github.com/Presscart/presscart-mcp/compare/v1.2.0...v1.3.0) (2026-10-21)


### Bug Fixes

* **openai-plugin:** skills never offer new purchases; reviewer prompts name the brand ([#21](https://github.com/Presscart/presscart-mcp/issues/21)) ([731767f](https://github.com/Presscart/presscart-mcp/commit/731767fc9f5db0f387ad452fa97254ff661479a4))


### Features

* **openai-plugin:** add listing URLs, logo and composer icon ([#22](https://github.com/Presscart/presscart-mcp/issues/22)) ([55d5ac4](https://github.com/Presscart/presscart-mcp/commit/55d5ac47cfa8de9f37f9732743b2fd6c09fbfad7))

# [1.2.0](https://github.com/Presscart/presscart-mcp/compare/v1.1.1...v1.2.0) (2026-10-20)


### Bug Fixes

* **directory:** encode every segment of article page links ([6af212e](https://github.com/Presscart/presscart-mcp/commit/6af212e7dde2677fe7096a6c7c54189d28511b99))
* **directory:** encode team slug in article page links ([85b8167](https://github.com/Presscart/presscart-mcp/commit/85b816704d0439ed5574c6efafb6459d74e7c7e5))
* **directory:** never return upstream status text from tool errors ([5aeb180](https://github.com/Presscart/presscart-mcp/commit/5aeb180c9bc1be4178279aaf4deea73f2b6d115e))
* **directory:** only return http(s) URLs from directory tools ([ac85d68](https://github.com/Presscart/presscart-mcp/commit/ac85d686cc373d7661b5a64168be54c98ee0b6ba))
* **directory:** reject dot-segment team slugs before calling the API ([8441728](https://github.com/Presscart/presscart-mcp/commit/84417289620c52c29b6f9cd2f439e1215120727f))
* **directory:** request outlet data for get_order ([b41254b](https://github.com/Presscart/presscart-mcp/commit/b41254b419d4a30806dc697af57ec24fb0d02e33))
* **directory:** validate team_slug before calling the API ([645c818](https://github.com/Presscart/presscart-mcp/commit/645c81869f192735fc4d7091dc8705f2e3eaa516))
* **http:** match directory routes and metadata paths exactly ([e874374](https://github.com/Presscart/presscart-mcp/commit/e874374108d839f8ee444c0ac53500bdfa70bbc6))
* **oauth:** directory routes accept only their own audience (PRE-1386) ([#17](https://github.com/Presscart/presscart-mcp/issues/17)) ([de3a385](https://github.com/Presscart/presscart-mcp/commit/de3a3853d951be4db44d001f8871c0fcd5eaf2ad)), closes [#910](https://github.com/Presscart/presscart-mcp/issues/910) [#910](https://github.com/Presscart/presscart-mcp/issues/910) [#910](https://github.com/Presscart/presscart-mcp/issues/910)
* **oauth:** stop advertising openid in direct-Supabase metadata (PRE-1397) ([#20](https://github.com/Presscart/presscart-mcp/issues/20)) ([079a815](https://github.com/Presscart/presscart-mcp/commit/079a815240d222fbd6c1fa1f9ffe20ee4d1248a6))
* **openai-plugin:** package the MCP server so Codex and ChatGPT load it (PRE-1388) ([#18](https://github.com/Presscart/presscart-mcp/issues/18)) ([77db3f7](https://github.com/Presscart/presscart-mcp/commit/77db3f7e2d2567a42da15c3998b422b6b0b9e456))
* **orders:** match camelCase and invoice/payment variants in the sanitizer ([e2e2ad6](https://github.com/Presscart/presscart-mcp/commit/e2e2ad6c7245651b7ac85c48801390af32ab4b11))
* **orders:** strip payment, Stripe, invoice and email fields from order tools ([5255520](https://github.com/Presscart/presscart-mcp/commit/525552039eea0f240b78237325b82fdf87fb5d05))


### Features

* **directory:** add allowlisting result builders with strict schemas ([59bd6cc](https://github.com/Presscart/presscart-mcp/commit/59bd6ccfe21282ec5b7b43953173411aff8bf4c8))
* **directory:** add directory profile policy and configuration ([b346720](https://github.com/Presscart/presscart-mcp/commit/b346720d524f7353c59f9445682f84d9f09a17cb))
* **directory:** get_user returns the account's display name (PRE-1388) ([#19](https://github.com/Presscart/presscart-mcp/issues/19)) ([99368f3](https://github.com/Presscart/presscart-mcp/commit/99368f3fe0a28c0a48fd5e8e5034de631d647399))
* **directory:** register Stage A read tools on directory MCP servers ([9a46d14](https://github.com/Presscart/presscart-mcp/commit/9a46d146522d83b5684744db3edcff900f7fc25b))
* **http:** mount directory MCP routes bound to their profile ([70fc258](https://github.com/Presscart/presscart-mcp/commit/70fc258b2d77028a9a724197a56ceeb01d9a2eed))
* **http:** serve the OpenAI apps domain challenge ([#15](https://github.com/Presscart/presscart-mcp/issues/15)) ([06c6e9e](https://github.com/Presscart/presscart-mcp/commit/06c6e9e739f86f6ede5c7a58a0b100676db98b98))
* **oauth:** accept several protected resources in the OAuth facade ([cf56bb8](https://github.com/Presscart/presscart-mcp/commit/cf56bb8e6b74027f95ce2e984091cf81421911c1))
* **oauth:** add per-resource bearer guards and directory audiences ([3054a81](https://github.com/Presscart/presscart-mcp/commit/3054a81537446fe3de52d9d340841ab91f4bda2b))
* **openai-plugin:** v0.2 connects to /mcp/openai (PRE-1388) ([#16](https://github.com/Presscart/presscart-mcp/issues/16)) ([5240e13](https://github.com/Presscart/presscart-mcp/commit/5240e1394c866a09af5fd31cdae3826dc7bc540e))

## [1.1.1](https://github.com/Presscart/presscart-mcp/compare/v1.1.0...v1.1.1) (2026-07-22)


### Bug Fixes

* **auth:** serve authorization server metadata on discovery aliases ([06aa189](https://github.com/Presscart/presscart-mcp/commit/06aa189871e36f26b3bda05c6d42812f407f942b))

# [1.1.0](https://github.com/Presscart/presscart-mcp/compare/v1.0.4...v1.1.0) (2026-07-21)


### Bug Fixes

* **auth:** accept the OIDC application_type field on registration ([e4f1de1](https://github.com/Presscart/presscart-mcp/commit/e4f1de12a15ff44f330c3cd5d84ecbc6de966996))
* **auth:** accept the OIDC prompt parameter on facade authorize ([0d68758](https://github.com/Presscart/presscart-mcp/commit/0d68758cf4044cde7786963b26fedc2a1e410e93))
* **auth:** align OAuth registration contracts ([ea2e231](https://github.com/Presscart/presscart-mcp/commit/ea2e2319d02584715734163c5a0ab6785cec367f))
* **auth:** complete portable OAuth refresh support ([699f1a0](https://github.com/Presscart/presscart-mcp/commit/699f1a0884ed27e9d495712a82e61217d7b72966))
* **auth:** harden OAuth facade request boundaries ([90de3bb](https://github.com/Presscart/presscart-mcp/commit/90de3bb83c50eecb7e01f9d1cc6d676c931aa4b2))
* **auth:** report canonical MCP resource ([d2d70e7](https://github.com/Presscart/presscart-mcp/commit/d2d70e7a6fa5949893fa6285a2039cb14d789b33))
* **auth:** require secure public OAuth URLs ([02a3550](https://github.com/Presscart/presscart-mcp/commit/02a35504d0f713ce03cabef509c86c1a226123f2))
* **auth:** share hosted OAuth route error handling ([441264c](https://github.com/Presscart/presscart-mcp/commit/441264cf5a32efc399099defb2f3932ae532a781))
* **auth:** validate DCR client secret consistency ([da1fc4c](https://github.com/Presscart/presscart-mcp/commit/da1fc4cf74f37f3aa4eeba231ddbfaf125fc2b55))
* **logs:** report idle MCP session cleanup at info level ([215650f](https://github.com/Presscart/presscart-mcp/commit/215650f5fa4b9d58af12e0b5f798294334b71884))


### Features

* **auth:** add stateless OAuth refresh translator ([0b5ed3e](https://github.com/Presscart/presscart-mcp/commit/0b5ed3ebcab22ee53a3d0c8da08f7f3a524cd8b1))
* **auth:** define OAuth facade protocol contract ([9fffe7b](https://github.com/Presscart/presscart-mcp/commit/9fffe7b5afaf7ec9aadb3852e6236e3082c2d01e))
* **auth:** support canonical and legacy MCP audiences ([7ea98d2](https://github.com/Presscart/presscart-mcp/commit/7ea98d2710f38bd5568004ba9fd87a6afaa2c710))
* **auth:** wire hosted OAuth refresh lifecycle ([9373be0](https://github.com/Presscart/presscart-mcp/commit/9373be0be73b3d81dbcc785403049e9684f27797))

## [1.0.4](https://github.com/Presscart/presscart-mcp/compare/v1.0.3...v1.0.4) (2026-06-30)


### Bug Fixes

* extend mcp session idle timeout ([6553dbe](https://github.com/Presscart/presscart-mcp/commit/6553dbedad68bc3b87e35a8c487f63fd40b31eb7))

## [1.0.3](https://github.com/Presscart/presscart-mcp/compare/v1.0.2...v1.0.3) (2026-06-29)


### Bug Fixes

* remove healthcheckPath from railway.json ([a87cf7c](https://github.com/Presscart/presscart-mcp/commit/a87cf7c6c73175904e393ea89dbba6d05c5005a2))

## [1.0.2](https://github.com/Presscart/presscart-mcp/compare/v1.0.1...v1.0.2) (2026-06-29)


### Bug Fixes

* remove healthcheckPath from railway.json ([a214c60](https://github.com/Presscart/presscart-mcp/commit/a214c603e2e7a185d57ce89544422c5c05324b69))

## [1.0.1](https://github.com/Presscart/presscart-mcp/compare/v1.0.0...v1.0.1) (2026-06-29)


### Bug Fixes

* **release:** avoid staging metadata commits ([fd47246](https://github.com/Presscart/presscart-mcp/commit/fd4724645a4d7c34370ba5238cf2637944232466))

# 1.0.0 (2026-06-29)


### Bug Fixes

* **articles:** return public article URLs in MCP ([f2af904](https://github.com/Presscart/presscart-mcp/commit/f2af9041a87062bd90a8811aa5a22e9274505b30))
* **http:** support Claude MCP connector preflight ([a45a132](https://github.com/Presscart/presscart-mcp/commit/a45a13276804bbace5fc2d55748e6a9cb6b76246))
* **mcp:** correct comments routes and publisher article links ([56571c4](https://github.com/Presscart/presscart-mcp/commit/56571c47a71ce5d212dc4f5c1e918594e880e25f))
* **mcp:** expose public user identity ([cd185c6](https://github.com/Presscart/presscart-mcp/commit/cd185c6b7dcfee07cca4edaa884d806ef885603d))
* **mcp:** guide writing add-on article flow ([f91d094](https://github.com/Presscart/presscart-mcp/commit/f91d094ab361059867cebe0de7d5b3b3f9bda50b))
* **mcp:** harden runtime error handling ([1b4ba23](https://github.com/Presscart/presscart-mcp/commit/1b4ba2322dd4cffc80ccdec3cb496b229cb64a09))
* **mcp:** hide internal auth config errors ([3e98bc1](https://github.com/Presscart/presscart-mcp/commit/3e98bc10949a19ab99b4d0ec78a63fc98ec92a14))
* **mcp:** improve tool discovery responses ([f41af68](https://github.com/Presscart/presscart-mcp/commit/f41af68ee73e075a68c38438c407ebf90f8c9d55))
* **mcp:** normalize product prices and whoami claims ([223b6ca](https://github.com/Presscart/presscart-mcp/commit/223b6ca96ebde5ac24a3c397b2875a3da3553d4e))
* **mcp:** prefer pro listing prices ([3a91294](https://github.com/Presscart/presscart-mcp/commit/3a9129488fb17cd1f58a51312dba910613939545))
* require outlet channel permissions ([f0d0785](https://github.com/Presscart/presscart-mcp/commit/f0d0785ef054c3826aa32b4b152f2d4b6f7fa623))
* **tools:** clarify mcp price output ([34e7564](https://github.com/Presscart/presscart-mcp/commit/34e7564acabdbc818ebfed3e9b616da3e62534ef))


### Features

* add campaign articles tool ([7cee349](https://github.com/Presscart/presscart-mcp/commit/7cee3496b45a6fead8bbb94ab8f975ecb3444b95))
* add marketplace location tools ([1da8ab9](https://github.com/Presscart/presscart-mcp/commit/1da8ab9d2c438a58e15090ff803e83eb33c515f8))
* add presscart mcp server ([f54c5da](https://github.com/Presscart/presscart-mcp/commit/f54c5da3e22ed753edca009c6907f6ab4649920f))
* add range filters for outlet search ([e2e699b](https://github.com/Presscart/presscart-mcp/commit/e2e699b4fa85f2ae0013491fbf56005f4e6f54d5))
* **campaigns:** add name-only campaign update tool ([954bb0c](https://github.com/Presscart/presscart-mcp/commit/954bb0ce3e00eb6a9225b300d6fd278825d521cc))
* **mcp:** add campaign content upload tools ([246d8bf](https://github.com/Presscart/presscart-mcp/commit/246d8bf2d4e3b39b92a0bac31666aac2ef94f6a3))
* **mcp:** add comment tools ([99502fd](https://github.com/Presscart/presscart-mcp/commit/99502fdd162b8974fc0b4542bbf689ff636b16af))
* **mcp:** add folder tools ([c7ee0d2](https://github.com/Presscart/presscart-mcp/commit/c7ee0d2a6a588922bf0a7fea9d322f1137f45ddd))
* **mcp:** add questionnaire template tool ([3fcf952](https://github.com/Presscart/presscart-mcp/commit/3fcf95207abceaa2c38b5c1cd3c32f1164206feb))
* **mcp:** add team discovery tool ([0f72951](https://github.com/Presscart/presscart-mcp/commit/0f729510a0fc93812613fec7514f60bec196c862))
* **mcp:** add tool metadata hints ([184fd44](https://github.com/Presscart/presscart-mcp/commit/184fd44e35fe8f17dbaf060aacf61f6f635297f0))
* **mcp:** rename checkout tool to create order ([6e2a9a3](https://github.com/Presscart/presscart-mcp/commit/6e2a9a389515f92cb6a1a0b06276d4367ee132a2))
* **oauth:** validate supabase mcp tokens ([0ee48c4](https://github.com/Presscart/presscart-mcp/commit/0ee48c45d20007c352c7501b7624ac61d9010ed9))
* **products:** add publisher product tools ([e34a852](https://github.com/Presscart/presscart-mcp/commit/e34a852377d854874fd8c69d8ab6d7835e0155c0))
* **tools:** add outlet channel tools ([22c6c9d](https://github.com/Presscart/presscart-mcp/commit/22c6c9ddcd409878c8728f913f5411c56b17fcc1))
* **tools:** add outlet management tools ([9944476](https://github.com/Presscart/presscart-mcp/commit/99444764f11937ebe86c2d4a9b853f12a4a3d34e))
* **tools:** add profile update tool ([a3b4a1f](https://github.com/Presscart/presscart-mcp/commit/a3b4a1f252355c4d0c3d8e683da53e8fadb43d47))
* **tools:** expose add-ons catalog ([69270cd](https://github.com/Presscart/presscart-mcp/commit/69270cd6e69776eaa363b316ab95354439ee2a49))
* use article comment routes ([ac607e8](https://github.com/Presscart/presscart-mcp/commit/ac607e8ef28083c832b14e5fe5badfccc07a87ee))

# Changelog

This file is generated by semantic-release.
