/* Ant Design Input forwards id to its native input; labels use htmlFor. */
/* eslint jsx-a11y/label-has-associated-control: ["error", {"assert": "htmlFor"}] */
import React, {Component} from "react";
import {Alert, Button, Checkbox, Input, Modal, Tabs, message} from "antd";
import {inject, observer} from "mobx-react";
import {CONTENT, MAX_MD_NUMBER} from "../../utils/constant";
import {saveLocalImage} from "../../utils/localImages";
import {fetchNotionPage} from "../../utils/notionApi";
import {importNotionPage} from "../../utils/notionImport";
import "./NotionDialog.css";

const BACKUP_KEY = "notion_import_previous_content";
const SAVED_TOKEN_KEY = "notion_import_saved_token";

@inject("content")
@inject("dialog")
@observer
class NotionDialog extends Component {
  constructor(props) {
    super(props);
    this.state = {
      mode: "link",
      url: "",
      token: "",
      rememberToken: false,
      busy: false,
      error: "",
      result: null,
      canRestore: false,
    };
  }

  componentDidUpdate() {
    const open = this.props.dialog.isNotionOpen;
    if (open && !this.wasOpen) {
      try {
        const savedToken = window.localStorage.getItem(SAVED_TOKEN_KEY);
        // Only runs on the closed-to-open transition, guarded above by wasOpen.
        // eslint-disable-next-line react/no-did-update-set-state
        this.setState({
          token: savedToken || "",
          rememberToken: savedToken !== null,
          canRestore: window.localStorage.getItem(BACKUP_KEY) !== null,
        });
      } catch (error) {
        // eslint-disable-next-line react/no-did-update-set-state
        this.setState({
          token: "",
          rememberToken: false,
          canRestore: false,
          error: "无法读取浏览器存储，密钥仍可仅用于本次读取。",
        });
      }
    }
    this.wasOpen = open;
  }

  close = () => {
    this.setState({token: "", error: "", result: null});
    this.props.dialog.setNotionOpen(false);
  };

  saveToken = (token, rememberToken) => {
    try {
      if (rememberToken) window.localStorage.setItem(SAVED_TOKEN_KEY, token);
      else window.localStorage.removeItem(SAVED_TOKEN_KEY);
      return true;
    } catch (error) {
      this.setState({error: "浏览器无法保存或删除密钥，请检查存储权限和剩余空间。"});
      return false;
    }
  };

  changeToken = (event) => {
    const token = event.target.value;
    if (this.state.rememberToken && !this.saveToken(token, true)) return;
    this.setState({token, result: null});
  };

  changeRememberToken = (event) => {
    const rememberToken = event.target.checked;
    if (this.saveToken(this.state.token, rememberToken)) this.setState({rememberToken});
  };

  convert = async (payload) => {
    this.setState({busy: true, error: "", result: null});
    try {
      const source = Object.prototype.hasOwnProperty.call(payload, "source")
        ? payload.source
        : await fetchNotionPage(payload.url, payload.token);
      const result = await importNotionPage(source);
      if (
        typeof result.markdown !== "string" ||
        result.markdown.length > MAX_MD_NUMBER ||
        !Array.isArray(result.images)
      ) {
        throw new Error("导入内容无效或超过编辑器的字符上限。");
      }
      this.setState({result});
    } catch (error) {
      this.setState({error: error.message || "读取失败，请检查页面内容或网络。"});
    } finally {
      this.setState(({rememberToken, token}) => ({busy: false, token: rememberToken ? token : ""}));
    }
  };

  readFile = (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      this.setState({error: "文件不能超过 16 MB。"});
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.convert({source: JSON.parse(reader.result)});
      } catch (error) {
        this.setState({error: "请选择已读取的 Notion JSON 文件。", result: null});
      }
    };
    reader.onerror = () => this.setState({error: "文件读取失败，请重新选择。"});
    reader.readAsText(file);
  };

  apply = () => {
    const {result} = this.state;
    if (!result) return;
    try {
      window.localStorage.setItem(BACKUP_KEY, this.props.content.content || "");
      // Reserve storage before updating the visible document or importing images.
      window.localStorage.setItem(CONTENT, result.markdown);
      result.images.forEach(saveLocalImage);
      this.props.content.setContent(result.markdown);
      this.close();
      message.success("已导入，可继续编辑文字和公式；导入前的内容已备份。");
    } catch (error) {
      this.setState({error: "浏览器存储空间不足，请先导出当前文章并清理存储后再导入。"});
    }
  };

  restore = () => {
    const previous = window.localStorage.getItem(BACKUP_KEY);
    if (previous === null) return;
    const current = this.props.content.content || "";
    try {
      window.localStorage.setItem(BACKUP_KEY, current);
      window.localStorage.setItem(CONTENT, previous);
      this.props.content.setContent(previous);
      this.close();
      message.success("已恢复，当前内容也已留在备份中。");
    } catch (error) {
      this.setState({error: "恢复失败，请先导出当前文章并清理浏览器存储。"});
    }
  };

  render() {
    const {url, token, rememberToken, mode, busy, error, result, canRestore} = this.state;
    return (
      <Modal
        title="从 Notion 导入"
        visible={this.props.dialog.isNotionOpen}
        onCancel={this.close}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        width={620}
        footer={[
          <Button key="restore" disabled={!canRestore || busy} onClick={this.restore}>
            恢复导入前内容
          </Button>,
          <Button key="cancel" disabled={busy} onClick={this.close}>
            取消
          </Button>,
          <Button key="import" type="primary" disabled={!result || busy} onClick={this.apply}>
            导入到编辑器
          </Button>,
        ]}
      >
        <div className="nice-notion-import">
          <p>在浏览器中读取和转换，保留文字颜色、高亮和公式。导入后可继续编辑。</p>
          <Tabs activeKey={mode} onChange={(value) => this.setState({mode: value, result: null, error: ""})}>
            <Tabs.TabPane tab="页面链接" key="link" disabled={busy}>
              <label htmlFor="nice-notion-url">Notion 页面链接</label>
              <Input
                id="nice-notion-url"
                value={url}
                disabled={busy}
                placeholder="https://www.notion.so/..."
                onChange={(event) => this.setState({url: event.target.value, result: null})}
              />
              <label htmlFor="nice-notion-token">Notion 连接密钥</label>
              <Input
                id="nice-notion-token"
                type="password"
                value={token}
                disabled={busy}
                autoComplete="off"
                placeholder={rememberToken ? "保存后，下次打开会自动填入" : "仅用于本次读取，不保存"}
                onChange={this.changeToken}
              />
              <Checkbox
                className="nice-notion-remember"
                checked={rememberToken}
                disabled={busy}
                onChange={this.changeRememberToken}
              >
                在此浏览器记住密钥
              </Checkbox>
              <p className="nice-notion-help">仅保存在当前浏览器；取消勾选即删除。未勾选时，读取结束后清空。</p>
              <p className="nice-notion-help">
                请在 Notion 中将页面授权给此连接。聊天中的 Notion 授权不能直接用于这个网页。
              </p>
              <Button onClick={() => this.convert({url, token})} loading={busy} disabled={!url.trim()}>
                读取页面
              </Button>
            </Tabs.TabPane>
            <Tabs.TabPane tab="已读取文件" key="file" disabled={busy}>
              <p>选择此前读取并保存的 Notion JSON 文件，内容在浏览器中转换，无需密钥。</p>
              <input
                aria-label="Notion JSON 文件"
                type="file"
                accept=".json,application/json"
                onChange={this.readFile}
                disabled={busy}
              />
              {busy && <p>正在读取并转换…</p>}
            </Tabs.TabPane>
          </Tabs>
          {error && <Alert type="error" showIcon message={error} />}
          {result && (
            <Alert
              type="success"
              showIcon
              message={result.title}
              description={`已读取 ${result.stats.inline_math + result.stats.display_math} 处公式、${
                result.stats.images
              } 张图片。折叠备注已展开。点击“导入到编辑器”替换当前正文，并保留一份导入前备份。`}
            />
          )}
          {result && result.warnings && result.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="导入提示"
              description={result.warnings.map((warning) => warning.message || warning.code).join("；")}
            />
          )}
        </div>
      </Modal>
    );
  }
}

export default NotionDialog;
