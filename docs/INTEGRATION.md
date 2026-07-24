# moveTIPS統合方針

## 対象

- 戦闘拡張: `D:\Dropbox\scripts\#GBFtools\testExtension`
- 統合先: `D:\Dropbox\scripts\#GBFtools\moveTIPS`

GBF実戦テスト完了までは統合しません。

## 競合する主要ファイル

- `manifest.json`
- `background.js`
- `sidepanel.html`
- `sidepanel.css`
- `sidepanel.js`

単純上書きは禁止し、機能単位で統合します。

## Manifest

統合対象:

- `content_scripts`
- `web_accessible_resources`
- GBF対象の `host_permissions`
- `storage`、`tabs`、`sidePanel` 権限
- Service Workerエントリーポイント

現行 `moveTIPS` の対象ホストは `https://game.granbluefantasy.jp/*` のみです。Mobage版を維持する場合は `*://gbf.game.mbga.jp/*` も統合します。

## Service Worker

統合後は多段 `importScripts` を整理し、可能なら次へ一本化します。

1. moveTIPS既存のサイドパネル起動処理
2. 戦闘イベント受信
3. 状態管理
4. scenario集計
5. キャラクター帰属

ただし、実機テスト前にリファクタリングして動作を変えないでください。

## サイドパネル

moveTIPSの既存TIPS表示と戦闘情報を、次のどちらかで統合します。

- タブ切り替え: `TIPS` / `戦闘情報`
- 上下セクション: TIPSの下に戦闘情報

画面幅が狭いため、推奨はタブ切り替えです。

## ストレージ

戦闘状態は `chrome.storage.session`、moveTIPS設定は既存ストレージを維持します。キー名の衝突を避け、戦闘状態は現在の `battle-state:<tabId>` 接頭辞を保持します。

## 統合テスト

- moveTIPSの既存TIPS選択・表示が壊れていない
- 拡張機能アイコンからサイドパネルが開く
- ページフックが一度だけ注入される
- タブ切り替え後も対象タブの戦闘情報を表示する
- GBF以外のタブでエラーを出さない
- 戦闘単体テストとmoveTIPS既存テストの両方が成功する

## Dropbox

統合前にバックアップを作成し、ファイル単位で段階的に反映します。同期ロック時は強制上書きせず、反映後に競合コピーとハッシュを確認します。
