# オンライン更新

## 利用者側

サイドパネル上部で6時間ごとに更新情報を確認します。「更新確認」で手動確認もできます。

- 導本辞書と第一次収縮の共有モデルは、更新番号が上がると自動取得・統合されます。
- 新しい拡張本体がある場合は「配布ページ」を表示します。GitHub ReleasesからZIPを取得し、展開済みフォルダーへ上書きして `chrome://extensions/` で再読み込みします。
- オンライン取得に失敗しても、保存済みデータと現在の拡張機能はそのまま利用できます。

Manifest V3ではオンライン上のJavaScriptを実行しません。GitHubから取得するものはJSONデータだけで、処理ロジックは拡張機能内に同梱します。

## リリース手順

1. `manifest.json` と `update/channel.json` の `version` を同じ値へ更新する。
2. 導本辞書を更新した場合は `data/guidebook-effects.json` を更新し、`guidebookRevision`を増やす。
3. 共有収縮モデルを更新した場合は `data/first-shrink-models.json` を更新し、`firstShrinkModelRevision`を増やす。
4. `node unit-test-v2.cjs` を実行する。
5. mainへpushし、同じバージョンの `v1.2.3` タグをpushする。

タグのGitHub Actionsが配布ZIPとReleaseを作成します。

## 制約

開発者モードで「パッケージ化されていない拡張機能」として読み込んだコードは、拡張機能自身では書き換えられません。そのため現構成で完全自動なのはJSONデータ更新までです。

コードまで無操作で更新する場合は、Chrome Web Storeの限定公開配布、または同一秘密鍵で署名したCRXと更新マニフェストを使う配布方式へ移行します。
