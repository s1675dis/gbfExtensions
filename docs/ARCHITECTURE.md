# アーキテクチャ

## オンライン更新

Service Workerは`update/channel.json`を6時間ごとに確認します。導本辞書と第一次収縮モデルはリポジトリ所有者が管理する固定URLからJSONとして取得し、既存ローカルデータへ非破壊統合します。適用済みrevisionと更新確認結果は`online-update-state:v1`へ保存します。新しいコード版は検知だけを行い、UIからGitHub Releasesを開きます。Manifest V3のリモートコード禁止に従い、取得JSONは同梱済みロジックで検証・解釈します。

## データフロー

```text
GBFページ
  ├─ jQuery ajaxSuccess ──────────────┐
  └─ WebSocket / Socket.IO message ──┤
                                     ↓
page-hook.js（ページコンテキスト）
                                     ↓ CustomEvent
content.js（拡張機能コンテキスト）
                                     ↓ chrome.runtime.sendMessage
service-worker-v2.js
  └─ service-worker.js
       └─ background.js
                                     ↓ chrome.storage.session
sidepanel.js → sidepanel.html
```

Chrome Debugger APIは使用していません。

## ファイルの責務

| ファイル | 責務 |
|---|---|
| `manifest.json` | 権限、対象ホスト、サイドパネル、Service Workerの宣言 |
| `page-hook.js` | jQuery AJAXとWebSocketの受信監視 |
| `content.js` | ページイベントをService Workerへ転送 |
| `background.js` | 基本状態、scenario解析、累計、参戦者、キャラクター集計、調査用Ajax履歴 |
| `service-worker.js` | 所有者不明ダメージのキャラクター誤帰属を防止 |
| `service-worker-v2.js` | 同一戦闘の累計保持、現在・前ターンの状態遷移 |
| `sidepanel.*` | 表示、IDコピー、貢献度短縮形式 |
| `route-planner.js` | ノード正規化、4ホップ抽出、収縮安全期限、価値回収・ボス経路探索 |
| `unit-test-v2.cjs` | V2状態遷移と表示形式の単体テスト |

## Game.viewノード調査

新機能テストタブからの取得要求は、`sidepanel.js` → Service Worker → `content.js` → `page-hook.js` の順に中継します。ページコンテキストで `window.Game.view.data` 以下の全own propertyを階層制限なしで走査し、同じ経路を逆向きに通してサイドパネルへ返します。

対象タブにcontent scriptの受信先がない場合、Service Workerは `chrome.scripting.executeScript` で `content.js` を再注入して1回だけ再送します。`content.js` 自体には多重登録を防ぐガードがあります。

走査ではown propertyを対象とし、循環参照は `$ref`、関数・アクセサ・DOM要素などは `$type` 付きのJSON互換表現にします。結果は表示・クリップボードコピー・JSONファイル保存だけに使用し、`chrome.storage` の戦闘状態には格納しません。

導本効果確認ページはLit描画DOMを正本として収集します。`btn_unique/rare/normal/cursed_on.png`から表示中カテゴリを判定し、`icon_book_effect/book_effect_N.png`を持つ行から効果本文とアイコン番号を取得します。`cursed`は`isCursed`として明示保存しますが、アイコン番号は`status_id`と一致しないため効果IDには流用しません。

同一導本効果はIDを優先し、ID不明時は正規化した効果名で統合します。観測経路は和集合にしますが、メタ情報は非空値だけで更新します。このため、候補レスポンスで得たランク・重複可否を、後続の戦闘報酬やDOM確認に含まれない`null`で失いません。直近バッチの時刻は履歴として永続化し、緑の表示ハイライトだけを60秒で失効させます。

サーバー名とDOM名では単語途中の改行位置が異なるため、保存同一性の比較では`<br>`と全空白を除去します。表示用名称は読みやすさのため元の文字列を保持します。同一文字列に複数の異なるIDが存在する場合は統合せず、IDが一意に確定できる場合だけID不明レコードを吸収します。既存データも読込時に同じ規則で修復します。

イベントscenarioの`action_type: 401`は表示候補、`action_type: 400`は選択なしの即時獲得として区別します。action 400のstatus_listは`event_reward`として獲得バッチを付け、`spacebook_reward_id`も保持します。rarity 99またはiconCategory 4を伴う場合は呪われた導本と判定します。

ショップDOMでは表示中の必要コインを`shopPrice`として取得します。通常価格が実測済みのランクは`shopBasePrice`を別に持ち、現在価格が通常価格を下回る場合は`shopDiscounted`、上回る場合は`shopPremium`を立てます。現時点の辞書はR1=50コインのみで、割引38・最終日ボス前の割増75を実測済みです。観測した価格は履歴として保持し、未確認ランクの通常価格は推測しません。

## Ajax状態更新調査

`page-hook.js` が既存の `ajaxSuccess` から送る全Ajaxイベントを、記録が有効なタブについてだけ `background.js` の調査用リングバッファへ複製します。戦闘集計用の `handleAjax` とは分離しているため、経路調査の開始・停止・クリアは戦闘状態へ影響しません。

履歴はタブ単位の `chrome.storage.session` に最大60件、JSON換算で合計約4MBまで保持します。単一イベントの要求・応答は約160KBで打ち切り、`truncated` を付けます。レスポンス全体を再帰走査し、現在ノード、経過ターン、所持通貨、訪問済みノード、収縮・瘴気に該当するキーを `candidates` として各履歴へ添付します。

この60件はサイドパネル表示用のキャッシュです。記録中の完全なAjaxは別経路でOrigin Private File System（OPFS）へ受信ごとに即時追記します。OPFSはChromeがAppData配下で管理する拡張機能専用領域で、`unlimitedStorage` 権限を使用します。アプリ側では件数・総容量による削除を行わず、単一ファイルが約5MBへ達するたびに次のJSON Linesファイルへ切り替えます。保存上限は端末の空き容量です。

記録開始ごとに新しいセッション名を生成し、各ファイルへ `session_start`、Ajax行、`session_end` を記録します。Service Workerが停止しても書込み済み行は残ります。サイドパネルはファイル一覧・サイズ・更新日時を取得し、選択した分割ファイルをユーザーの通常のダウンロード先へ保存できます。

## 最適ルート

「最適ルート」タブは、全階層調査とは別の軽量要求で `window.Game.view.data` と `__rawResponseData.option.dungeon` からノード、現在地、ターン、通貨、収縮状態を取得します。以後は全Ajaxを監視している既存経路から、`move_node`・イベント応答の現在地、`total_turn`、`miasma_info.after`、`shrink_node_ids` をメモリ上のタブ別ルート状態へ反映します。ダンジョン再表示の `node_list` は完全状態として再同期します。

イベントアイテムは同じタブ別ルート状態の`dungeonItems`へ保持します。scenarioの`action_type: 600 / dungeon_item_list`は獲得直後の差分、`/rest/arcarum3/dungeon/dungeon_item_list`は現在所持品の完全一覧として扱います。ID 4「監獄の鍵」の有無から`prisonKeyCount`を導出し、固定event 11の条件付き評価へ渡します。完全一覧に存在しなくなったアイテムは消費済みとして除外します。

現在地は通常の`currentNodeId`に加え、演出上の座標を示す`actualCurrentNodeId`を保持できます。浮遊城本体の孤立ノード（type 10 / specialType 4 / XY 346,292）へ一時移動した場合、`actualCurrentNodeId`だけを孤立ノードへ更新し、経路計算用`currentNodeId`は移動前の浮遊城転移マスを`floatingCastleReturnNodeId`として維持します。この場面で返る孤立ノード1件だけの`node_list`は一時スナップショットとみなし、既存の全MAPを置換しません。

移動応答に現在地フィールドがない場合は、`move_node`要求の`node_id`を到着地として補完します。通常戦闘・通常イベント・宝箱・回復から離れたことが確認できた時点で、応答後の種別だけでなく更新前のnode種別を参照して消化済みを推定します。これにより、宝箱の公式訪問済み反映が遅い場合や応答中ですでに空白へ再分類された場合も、再び高価値宝箱として経路へ採用しません。

特殊イベントノードは全MAP共通の `x|y` を安定キーとして `chrome.storage.local` に蓄積します。map、base pattern、pattern、node ID、初期配置か1日目ボス後追加かは `appearances` 配列へ観測履歴として保持します。ページスナップショットから未訪問配置を記録し、特殊イベント上で `action_scenario_list` を含むAjaxを観測した場合はendpointと識別用スカラー値を同じ座標記録へ統合します。

第一次収縮円は三段階で決定します。`route-first-shrink-models:v1`の自己学習モデルを最優先し、次に組込み済み実測patternモデル、どちらもなければ`limitCircle.position`を左上、半径670として最終円を初期推定します。左上座標がない場合は取得済み円中心、サーバー中心、MAP重心の順で補完します。組込みモデルがあるpatternでは従来どおり画像外形で実測境界を上書きしません。

第一次収縮完了時は、安全nodeと瘴気nodeの両方が2件以上あれば`inferCircleFromObservedMiasma()`で境界円を自動フィットします。サーバー中心で無矛盾に分類できる場合は中心を固定し、そうでなければ中心を探索します。半径は安全側最遠点と瘴気側最近点の中間です。分類誤差が全nodeの8%または2件を超える観測は学習へ入れません。

学習キーは`mapId:basePatternId:patternId:dayIndex`です。各モデルは最大20サンプルを`chrome.storage.local`へ保持し、中心X/Y、最終半径、開始半径を中央値で統合します。同一タブの同じ境界を30秒以内に再同期しても重複観測にしません。学習完了時はタブ別`firstShrinkFinalCircle`も学習円へ置き換え、第二収縮が始まる前に開始形状を確定します。

`route-planner.js` はChrome APIやDOMに依存しない純粋な計算モジュールです。Service Workerも同じモジュールを読み込み、`page-hook.js`の250msフィールド再同期と全arcarum3 Ajax更新を受けるたび、収縮完了条件を満たせば学習候補を生成します。転移2地点を特殊edgeとして加え、現在地から4ホップを表示対象にします。第一収縮中は円中心からの距離と残りターンから未観測ノードの安全期限を保守的に推定し、各候補から恒久安全圏へ退避できることをhard constraintにしたbeam searchを行います。ボス配置後は瘴気ノードを避ける最短ボス経路へ切り替えます。Ajax更新通知を受けたタブが表示中なら300msでまとめて再取得・再計算します。

第2収縮ではボスノードを固定アンカーとする`simulateSecondShrinkArea()`を使用します。開始形状は第一次最終安置円で、半径と「円中心からボスまでのベクトル」を同じ残り縮尺で小さくします。ボスは円中心ではなく、円内の相対位置を維持します。移動する円境界と各nodeが交差する進捗を二分探索し、絶対安全期限へ変換します。座標がない場合はボスまでのグラフ距離で代替します。期限はedge移動だけでなく目的nodeの最低処理ターンにも適用し、ボス到着5ターン余裕と瘴気侵入0を同時に満たす経路だけを寄り道候補にします。

転移2地点間の特殊edgeは経路計算用グラフだけへ追加します。4ホップ表示用グラフは物理的な `adjacentIds` だけを使用し、推奨経路が転移edgeを使う場合も転移元で表示を打ち切ります。UIは転送の実行・非実行だけを示し、転移先の現在地更新を受信するまで転移先エリアを描画しません。

## 状態モデル

タブごとに `chrome.storage.session` と `chrome.storage.local` へ保存します。さらに最新の戦闘状態を `chrome.storage.local` に保存し、ページリロードやタブ置換後に同じ `raid_id` の `start.json` を受信した場合だけ復元します。

主なフィールド:

| フィールド | 内容 |
|---|---|
| `battleId` | `raid_id`。新規戦闘判定の主キー |
| `participationId` | 救援・参戦ID |
| `totalDamage` | 戦闘全体の累計与ダメージ |
| `statsTurn` | 現在集計中のターン番号 |
| `currentTurn` | 現在ターンのhit・各ダメージ |
| `previousTurn` | 確定した前ターンのhit・各ダメージ |
| `frontFormation` | キャラクター別表示に使う現在のフロント配置 |
| `characterStats` | 現在ターンのキャラクター別集計 |
| `previousCharacterStats` | 確定した前ターンのキャラクター別集計 |
| `members` | 参戦者とMVP情報 |

導本候補は戦闘状態とは独立した`guidebook-effects:v1`へID単位で永続保存します。効果本文から抽出した計算用数値は台帳を変更せず、派生データ`guidebook-effect-values:v1`へ別保存します。

## ターン遷移

アビリティ・召喚・奥義などは、レスポンスの `status.turn` と現在の `statsTurn` を比較して `currentTurn` へ加算します。

通常攻撃結果では、レスポンスの `status.turn` が次ターンになっているため、次の順序で処理します。

1. 通常攻撃ダメージを進行前の `currentTurn` へ加算する。
2. 完成した `currentTurn` を `previousTurn` へコピーする。
3. キャラクター別集計を `previousCharacterStats` へコピーする。
4. `currentTurn` と現在キャラクター別集計を0へ戻す。
5. `statsTurn` をレスポンスの次ターンへ更新する。

ボス撃破時は次ターンへ進まないため、この移動を行いません。

## 累計与ダメージ

`totalDamage` はターン遷移処理と分離されています。対象resultのscenarioを受信するたびに加算し、別の `raid_id` の `start.json` が来た場合のみリセットします。

同じ戦闘の `start.json` 再受信では、累計・現在ターン・前ターンを保持します。
リロード後も同じ `raid_id` ならキャラクター・参戦者を含む保存済み状態を復元します。異なる `raid_id` の保存値を流用することはありません。

## キャラクター帰属

優先的に以下を利用します。

1. 通常攻撃・奥義の `action.num`
2. `damage` / `loop_damage` 直前の `ability`、`special`、`special_npc` の `num`
3. `windoweffect.kind` 内のPIDと戦闘開始時キャラクターPIDの照合

特定できない場合、全体集計へは加算しますがキャラクター別には加算しません。

## デバフ数

バージョン1.6.1以降はデバフカウントをオミットしています。互換性維持のため旧状態フィールドと解析ヘルパーは残っていますが、AJAX結果・WebSocketのどちらからも呼び出さず、集計・表示しません。再設計時に実レスポンスを基準として置き換えます。

## 導本効果リスト

`background.js`は`/rest/arcarum3/dungeon/proceed_node_event`のAjax応答を走査し、scenario内の`action_type: 401`に含まれる`status_list`を全件取得します。ユーザーが選択した`status_id`ではなく候補一覧そのものを保存するため、候補として画面に表示されれば獲得しなくても記録できます。

戦闘リザルトでは、`page-hook.js`が表示用の`window.Game.view.arcarum3RewardList`、従来のconstructor側、生データの`content_model.attributes.option.result_data.arcarum3.reward_list`を250ms間隔で常時確認します。表示用の`rewardType: 4 / comment`形式と、生データの`reward_type: 4 / detail: [{status_id, icon_type, name}]`形式を正規化し、detailが複数なら効果ごとに展開します。Ajax直後、`pageshow`、タブ再表示時にも確認し、同じ効果はID・名称・画像で送信前に統合します。画面切替途中の読み取り例外は無視し、次回監視で再試行します。

導本台帳の正本は`chrome.storage.local`の実観測レコードだけです。サイドパネルへ返す際にID 1〜100の未観測部分を`isPlaceholder`付き空枠として補完し、101以降とID不明レコードを連結します。これにより保存済み情報を空データで上書きしません。候補バッチと実獲得バッチは別フィールドで管理し、戦闘報酬、イベントstatus-add、ショップ購入・売切変化、既知所持数の増加を獲得契機として記録します。ショップ・導本確認ページではAjax後だけ表示DOMを再取得し、購入後の変化を自動検出します。

導本台帳のPC間移行には`gbf-guidebook-effects-v1` JSONを使用します。サイドパネルがファイルを検証してService Workerへ渡し、Service Worker側で既存台帳と統合してから`chrome.storage.local`へ保存します。空placeholderは転送せず、ID一致または固定化効果名で対応付けます。配列情報は集合和、カウンターは最大値、時刻は最古／最新を選ぶため、同じスナップショットを繰り返し読み込んでも状態が膨張しません。

導本本文に現在進捗が埋め込まれる場合、台帳名は初期値0へ正規化します。`(現在値/最大値)`と単位付き`(現在値/必要数)`を`effectTemplate`、`effectVariables`、`lastObservedVariableValues`へ分離し、固定効果の同一性と実行時の可変値を混在させません。生の表示文面は`observedNames`へ保存します。将来のイベント連動計算は台帳の変数schemaを読み、戦闘単位のランタイム値を別状態として更新する前提です。

残回数表記`(残りn/m回)`は通常の進捗値と逆方向なので、辞書初期値を0ではなく最大値mへ固定し、`format: remaining-count`として保存します。またリザルトの`sephirabook_*_random`には効果名ではなく画面遷移案内が入る場合があるため、「探索画面に戻ることで～導本効果を獲得できます」は非効果テキストとして抽出・保存・既存データ移行の全段階で除外します。

保存単位は導本効果IDです。サーバーから取得した`name`自体を効果本文として扱い、レアリティ、重複可否、候補数、選択数、初回・最終観測時刻、観測回数とともに`guidebook-effects:v1`へ永続保存します。表示とJSONコピーでは`name`内の`@@`を改行へ変換します。

計算対象の本文は`GUIDEBOOK_EFFECT_VALUE_DEFINITIONS`、読み替えは`GUIDEBOOK_EFFECT_FLAG_DEFINITIONS`、追撃は`GUIDEBOOK_CHASE_DEFINITIONS`で解析します。百分率、固定値、導本個数、回数、真偽効果を別単位として`guidebook-effect-values:v1`へ保存します。派生レコードは元のID/key/name、重複可否、観測所持数、所持数の確認有無、各基礎値と所持数反映後の`totalValue`を持ち、元台帳からいつでも再生成できます。

追撃は導本IDを`slotKey`にするため、同じIDの複数所持だけが加算され、異なるIDは同じ「自属性奥義追撃」でも別枠です。名称の前半から種族・得意武器・HP条件・地帯・攻撃回数条件を抽出して表示ラベルへ付けます。現在所持数は効果確認ページの`count`だけを正本とし、値がない派生レコードは`ownedCountKnown: false / ownedCount: 0`にします。全期間の獲得観測回数である`acquisitionCount`は現在所持計算へ使用しません。

「獲得導本効果」UIは`ownedCountKnown: true`かつ`ownedCount > 0`のレコードから算出された`totalValue != 0`の項目だけを生成します。未所持・所持数未確認・合計0の定義済み項目は表示しません。割合、追撃、固定値、導本個数、回数、特殊効果を同じ基準で絞り、空区分だけ「有効な効果なし」を表示します。条件付き効果の戦闘中発動判定は別のランタイム状態が必要なため、この段階の有効判定は現在所持中かどうかに限定します。

現在所持数`count`は探索単位の状態です。ルート状態を取得するたび、タブ別`guidebook-sortie-state:v1:<tabId>`へターン、現在地、訪問済みnode集合を保存します。取得済み進捗からT0～1へ戻る、または複数訪問済みから開始地点1件へ戻った場合だけ新規出撃と判定し、全導本の`count`を0へ戻して派生効果値を再生成します。候補辞書、メタ情報、`acquisitionCount`など全期間の観測履歴は変更しません。同一進捗のページリロードは新規出撃になりません。

戦闘報酬には導本IDがないため、正規化した`comment`を`name:`キーとして保存します。既存のID付き効果と名称が一致すれば同じレコードへ統合し、後からイベント候補でIDが判明した場合は`id:`キーへ移行します。収集元は`event_candidate`と`battle_reward`の両方を保持します。

候補更新時は`GBF_GUIDEBOOK_EFFECTS_UPDATED`を送信し、開いている「導本リスト」タブを即時更新します。一覧取得は`GBF_GET_GUIDEBOOK_EFFECTS`を使用します。手入力欄と説明編集APIはありません。

イベント選択肢の各Ajax応答には時刻と連番からなる`lastCandidateBatchId`を割り当て、同じ応答の`status_list`全件へ保存します。UIは`lastCandidateBatchId`が最新の行だけを「直近の選択肢」としてハイライトします。戦闘報酬の`guidebook_rewards`は既存の候補batch情報を消さず、新しいbatchも作りません。

導本候補のAjax抽出はAjax履歴の記録状態から独立して常時実行します。arcarum3配下のレスポンスを再帰探索し、`action_type: 401`の明示scenario、またはID・名称と複数の導本メタ情報を持つ`status_list/statusList`を収集します。このため浮遊城など別エンドポイントの入れ子レスポンスにも対応し、メタ情報の少ない通常戦闘statusは除外します。

手動取得はsidepanelの`GBF_CAPTURE_GUIDEBOOK_EFFECTS`からbackgroundの再注入対応`requestPageCapture()`を経由し、content scriptへ要求します。`page-hook.js`は現在の`Game.view`を循環参照・DOM・getterを避け、最大深度10・最大10000 objectで探索します。`action_type: 401`の`status_list`、全階層の`rewardType: 4`、ショップ・導本効果確認ページにある導本固有画像／格納経路／メタ情報付き効果を`guidebook_capture`として返します。backgroundはこれを`guidebook_manual_capture`へ変換し、自動取得と同じID・効果名統合処理へ渡します。ショップと効果確認はそれぞれ`shop_page`、`effect_confirmation`を収集元として保持し、イベント候補batchは更新しません。

格納形式が未知の画面は`GBF_INSPECT_GUIDEBOOK_STORAGE`で診断します。page-hookは`Game.view`スナップショットに加え、通常の関数シリアライズでは辿らないconstructor静的プロパティとprototypeを個別にown-property展開します。現在ページDOMと、導本関連キー・効果文字列・効果オブジェクト風スキーマを持つ位置のパス索引も含め、sidepanelでJSONファイルとして保存します。この要求だけはデータ量を考慮して45秒待機します。

ページ全体HTMLは100万文字で打ち切るため、後方にあるタブ内容の調査には`guidebookDomInventory`を使います。これは`#root li`ごとに本文、画像、class、祖先階層、限定長の行HTMLを保存し、導本関連画像も別索引にします。呪われた導本などDOM後方の構造はこの一覧から比較します。

同じ診断経路は、全タブ共通の「導本未取得をコピー」でも使用します。対象画面を残したまま実行し、診断本体へ現在の導本辞書と取得済みAjax履歴を加えた`gbf-guidebook-capture-failure-v1`をクリップボードへ出力します。取得トーストが出なかった未知イベントでは、このコピーを一次調査資料とします。

導本効果確認ページ`#arcarum3/book`はLit描画DOMが正本です。`Game.view.rawResponseData.display_list`は通常アイテム所持一覧で導本効果ではありません。手動取得時は`book_effect_*.png`を持つ行から隣接本文と`×n`を読み、IDなしの`effect_confirmation`として名称統合へ渡します。

ショップ`#arcarum3/dungeon_shop`もLit描画DOMが正本です。`#js-prt-dungeon-shop-content-list`内で`book_effect_*.png`を持つ商品行から本文、コイン価格、売切画像、`base_book_n.png`を読み、IDなしの`shop_page`として名称統合へ渡します。ショップ固有値は後から導本確認ページを取得しても保持します。

hit予測、奥義ゲージ・バフスナップショット、学習履歴、予測UIはバージョン1.13.67で削除しました。`page-hook.js`はキャラクター別表示に必要な`formation`だけを送信します。旧v3/v4学習履歴は更新時にストレージから削除します。
