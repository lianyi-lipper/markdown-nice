/* Ant Design controls forward id to their input. */
/* eslint jsx-a11y/label-has-associated-control: ["error", {"assert": "htmlFor"}] */
import React, {Component} from "react";
import {Alert, Button, InputNumber, Modal, message} from "antd";
import {inject, observer} from "mobx-react";
import {
  COVER_DRAFT_KEY,
  COVER_HEIGHT,
  COVER_WIDTHS,
  createCoverDraft,
  normalizeCoverDraft,
} from "../../utils/coverDraft";
import {
  renderCoverContent,
  waitForCoverAssets,
  coverOverflows,
  exportCoverPng,
  readCoverImage,
} from "../../utils/coverRenderer";
import "./CoverDialog.css";

const KEYS = ["wide", "square"];
const NAMES = {wide: "横版", square: "方版"};
const SHEET_WIDTH = COVER_WIDTHS.wide + COVER_WIDTHS.square;

@inject("content")
@inject("dialog")
@observer
class CoverDialog extends Component {
  constructor(props) {
    super(props);
    this.state = {
      draft: createCoverDraft(),
      html: {wide: "", square: ""},
      overflow: {wide: false, square: false},
      scale: 0.75,
      rendering: false,
      busy: false,
      error: "",
      storageError: "",
      selection: "",
    };
    this.canvases = {};
    this.revision = 0;
  }

  componentDidUpdate(previousProps, previousState) {
    const open = this.props.dialog.isCoverOpen;
    if (open && !this.wasOpen) {
      this.wasOpen = true;
      this.open();
      return;
    }
    this.wasOpen = open;
    if (open && previousState.draft !== this.state.draft) {
      this.saveDraft();
      this.schedulePreview();
    }
  }

  componentWillUnmount() {
    this.revision += 1;
    clearTimeout(this.previewTimer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }

  open = () => {
    const editor = this.props.content.markdownEditor;
    const selection = editor ? editor.getSelection() : "";
    let draft = createCoverDraft(selection);
    let storageError = "";
    try {
      const saved = window.localStorage.getItem(COVER_DRAFT_KEY);
      if (saved) draft = normalizeCoverDraft(JSON.parse(saved));
    } catch (error) {
      storageError = "无法读取上次封面草稿，本次仍可编辑和导出。";
    }
    this.setState({draft, selection, error: "", storageError, rendering: true});
  };

  close = () => {
    if (this.state.busy) return;
    this.revision += 1;
    clearTimeout(this.previewTimer);
    this.props.dialog.setCoverOpen(false);
  };

  saveDraft = () => {
    try {
      window.localStorage.setItem(COVER_DRAFT_KEY, JSON.stringify(normalizeCoverDraft(this.state.draft)));
      if (this.state.storageError) this.setState({storageError: ""});
    } catch (error) {
      this.setState({storageError: "浏览器空间不足，当前修改未能保存；可继续编辑并导出图片。"});
    }
  };

  updatePanel = (key, values) => {
    this.setState(({draft}) => ({
      draft: {...draft, [key]: {...draft[key], ...values}},
      rendering: true,
      error: "",
    }));
  };

  schedulePreview = () => {
    const revision = ++this.revision;
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(revision), 180);
  };

  current = (revision) => revision === this.revision && this.props.dialog.isCoverOpen;

  renderPreview = async (revision) => {
    const {draft} = this.state;
    try {
      const rendered = await Promise.all(
        KEYS.map((key) => renderCoverContent(draft[key], draft.images, COVER_WIDTHS[key])),
      );
      if (!this.current(revision)) return;
      this.setState({html: {wide: rendered[0], square: rendered[1]}}, () => this.measurePreview(revision));
    } catch (error) {
      if (this.current(revision)) this.setState({rendering: false, error: error.message || "预览生成失败，请重试。"});
    }
  };

  measurePreview = async (revision) => {
    try {
      await waitForCoverAssets(this.sheet);
      if (!this.current(revision)) return;
      this.setState({
        rendering: false,
        overflow: {wide: coverOverflows(this.canvases.wide), square: coverOverflows(this.canvases.square)},
      });
    } catch (error) {
      if (this.current(revision)) this.setState({rendering: false, error: "图片尚未加载成功，请重新插入图片。"});
    }
  };

  setPreviewViewport = (node) => {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (!node) return;
    const resize = () => {
      const scale = Math.min(1, node.clientWidth / SHEET_WIDTH);
      if (scale > 0 && scale !== this.state.scale) this.setState({scale});
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(node);
    resize();
  };

  insertImage = async (key, file, range) => {
    if (!file || this.state.busy) return;
    this.setState({busy: true, error: ""});
    try {
      const dataUrl = await readCoverImage(file);
      const id = `img-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      this.setState(({draft}) => {
        const {text} = draft[key];
        const start = range ? range[0] : text.length;
        const end = range ? range[1] : text.length;
        return {
          draft: {
            ...draft,
            images: {...draft.images, [id]: dataUrl},
            [key]: {...draft[key], text: `${text.slice(0, start)}\n![](cover-image://${id})\n${text.slice(end)}`},
          },
          rendering: true,
        };
      });
    } catch (error) {
      this.setState({error: error.message || "图片读取失败。"});
    } finally {
      this.setState({busy: false});
    }
  };

  paste = (key, event) => {
    const item = Array.from(event.clipboardData.items).find((entry) => entry.type.startsWith("image/"));
    if (!item) return;
    event.preventDefault();
    this.insertImage(key, item.getAsFile(), [event.target.selectionStart, event.target.selectionEnd]);
  };

  fitText = (key) => {
    const canvas = this.canvases[key];
    if (!canvas || this.state.rendering) return;
    const original = this.state.draft[key].fontSize;
    let size = original;
    while (size > 12 && coverOverflows(canvas)) {
      size -= 1;
      canvas.style.fontSize = `${size}px`;
    }
    canvas.style.fontSize = `${original}px`;
    this.updatePanel(key, {fontSize: size});
  };

  download = async () => {
    const {draft, rendering, busy, error} = this.state;
    if (rendering || busy || error) return;
    if (KEYS.some((key) => !draft[key].text.trim())) {
      this.setState({error: "请分别填写横版和方版题目。"});
      return;
    }
    this.setState({busy: true});
    try {
      await waitForCoverAssets(this.sheet);
      const blob = await exportCoverPng(this.sheet);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "公众号双封面.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      message.success("已导出：左侧横版，右侧方版。");
    } catch (exportError) {
      this.setState({error: exportError.message || "导出失败，请重试。"});
    } finally {
      this.setState({busy: false});
    }
  };

  renderNumber = (key, field, label, min, max, step = 1) => {
    const id = `nice-cover-${key}-${field}`;
    return (
      <div className="nice-cover-control">
        <label htmlFor={id}>{label}</label>
        <InputNumber
          id={id}
          min={min}
          max={max}
          step={step}
          disabled={this.state.busy}
          value={this.state.draft[key][field]}
          onChange={(value) => {
            if (typeof value === "number" && Number.isFinite(value))
              this.updatePanel(key, {[field]: Math.max(min, Math.min(max, value))});
          }}
        />
      </div>
    );
  };

  renderPanel = (key) => {
    const {draft, busy, selection, rendering} = this.state;
    const other = key === "wide" ? "square" : "wide";
    return (
      <section className="nice-cover-editor" key={key} aria-labelledby={`nice-cover-${key}-title`}>
        <h3 id={`nice-cover-${key}-title`}>{`${NAMES[key]} · ${key === "wide" ? "2.35:1" : "1:1"}`}</h3>
        <div className="nice-cover-actions">
          <Button size="small" disabled={busy || !selection} onClick={() => this.updatePanel(key, {text: selection})}>
            带入正文选区
          </Button>
          <Button size="small" disabled={busy} onClick={() => this.updatePanel(key, {text: draft[other].text})}>
            {`复制${NAMES[other]}内容`}
          </Button>
          <label htmlFor={`nice-cover-${key}-file`} className={`nice-cover-file${busy ? " is-disabled" : ""}`}>
            插入图片
            <input
              id={`nice-cover-${key}-file`}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files[0];
                event.target.value = "";
                this.insertImage(key, file);
              }}
            />
          </label>
        </div>
        <textarea
          id={`nice-cover-${key}-text`}
          aria-label={`${NAMES[key]}题目`}
          className="ant-input nice-cover-source"
          value={draft[key].text}
          disabled={busy}
          rows={5}
          spellCheck={false}
          placeholder="在这里编辑题目，支持 Markdown、LaTeX 公式和粘贴图片"
          onPaste={(event) => this.paste(key, event)}
          onChange={(event) => this.updatePanel(key, {text: event.target.value})}
        />
        <div className="nice-cover-settings">
          {this.renderNumber(key, "fontSize", "字号", 12, 72)}
          {this.renderNumber(key, "lineHeight", "行距", 1, 2.5, 0.1)}
          {this.renderNumber(key, "padding", "边距", 0, 80)}
          {this.renderNumber(key, "imageWidth", "图片宽度 %", 10, 100, 5)}
          <div className="nice-cover-control">
            <label htmlFor={`nice-cover-${key}-align`}>水平对齐</label>
            <select
              className="ant-input"
              id={`nice-cover-${key}-align`}
              disabled={busy}
              value={draft[key].align}
              onChange={(event) => this.updatePanel(key, {align: event.target.value})}
            >
              <option value="left">居左</option>
              <option value="center">居中</option>
              <option value="right">居右</option>
            </select>
          </div>
          <div className="nice-cover-control">
            <label htmlFor={`nice-cover-${key}-vertical`}>垂直对齐</label>
            <select
              className="ant-input"
              id={`nice-cover-${key}-vertical`}
              disabled={busy}
              value={draft[key].vertical}
              onChange={(event) => this.updatePanel(key, {vertical: event.target.value})}
            >
              <option value="top">顶部</option>
              <option value="center">居中</option>
              <option value="bottom">底部</option>
            </select>
          </div>
          <Button size="small" disabled={busy || rendering} onClick={() => this.fitText(key)}>
            缩小字号以适应
          </Button>
        </div>
      </section>
    );
  };

  render() {
    const {draft, html, scale, busy, rendering, overflow, error, storageError} = this.state;
    const overflowing = KEYS.filter((key) => overflow[key]);
    const savedStatus = storageError ? "草稿未保存" : "草稿自动保存在此浏览器";
    return (
      <Modal
        title="公众号双封面"
        className="nice-cover-dialog"
        width={1180}
        style={{top: 24}}
        visible={this.props.dialog.isCoverOpen}
        onCancel={this.close}
        maskClosable={!busy}
        closable={!busy}
        keyboard={!busy}
        footer={[
          <span key="size" className="nice-cover-export-size">
            PNG · 2680 × 800
          </span>,
          <Button key="close" disabled={busy} onClick={this.close}>
            关闭
          </Button>,
          <Button
            key="export"
            type="primary"
            onClick={this.download}
            loading={busy}
            disabled={rendering || !!error || KEYS.some((key) => !draft[key].text.trim())}
          >
            左右拼接导出
          </Button>,
        ]}
      >
        <div className="nice-cover-help">两栏分别编辑，下方预览最终拼图。上传公众号后，横版裁左侧，方版裁右侧。</div>
        <div className="nice-cover-editors">{KEYS.map(this.renderPanel)}</div>
        <div className="nice-cover-preview-heading">
          <span>合成预览</span>
          <span>{rendering ? "正在更新…" : savedStatus}</span>
        </div>
        <div className="nice-cover-preview" ref={this.setPreviewViewport}>
          <div style={{height: COVER_HEIGHT * scale, position: "relative"}}>
            <div
              className="nice-cover-sheet tex2jax_ignore"
              ref={(node) => {
                this.sheet = node;
              }}
              style={{transform: `scale(${scale})`}}
            >
              {KEYS.map((key) => (
                <div
                  key={key}
                  className="nice-cover-canvas"
                  data-cover-panel={key}
                  ref={(node) => {
                    this.canvases[key] = node;
                  }}
                  style={{
                    width: COVER_WIDTHS[key],
                    padding: draft[key].padding,
                    fontSize: draft[key].fontSize,
                    lineHeight: draft[key].lineHeight,
                    textAlign: draft[key].align,
                    justifyContent: {top: "flex-start", center: "center", bottom: "flex-end"}[draft[key].vertical],
                    "--cover-image-width": `${draft[key].imageWidth}%`,
                    "--cover-image-height": `${COVER_HEIGHT - 2 * draft[key].padding}px`,
                  }}
                >
                  <div className="nice-cover-content" dangerouslySetInnerHTML={{__html: html[key]}} />
                </div>
              ))}
            </div>
            <div className="nice-cover-divider" style={{left: COVER_WIDTHS.wide * scale}} />
          </div>
        </div>
        <div className="nice-cover-preview-labels">
          <span>左：横版 2.35:1</span>
          <span>右：方版 1:1 · 分界线不导出</span>
        </div>
        {!rendering && overflowing.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`${overflowing
              .map((key) => NAMES[key])
              .join("、")}内容接近或超出边缘，请检查预览；仍可按当前效果导出。`}
          />
        )}
        {storageError && <Alert type="warning" showIcon message={storageError} />}
        {error && <Alert type="error" showIcon message={error} />}
      </Modal>
    );
  }
}

export default CoverDialog;
