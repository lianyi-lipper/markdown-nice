import React, {Component} from "react";
import CodeMirror from "@uiw/react-codemirror";
import "codemirror/addon/search/searchcursor";
import "codemirror/keymap/sublime";
import "antd/dist/antd.css";
import {observer, inject} from "mobx-react";
import classnames from "classnames";
import throttle from "lodash.throttle";

import Dialog from "./layout/Dialog";
import Navbar from "./layout/Navbar";
import Footer from "./layout/Footer";
import Sidebar from "./layout/Sidebar";
import StyleEditor from "./layout/StyleEditor";
import EditorMenu from "./layout/EditorMenu";
import SearchBox from "./component/SearchBox";

import "./App.css";
import "./utils/mdMirror.css";

import {
  LAYOUT_ID,
  BOX_ID,
  IMAGE_HOSTING_NAMES,
  IMAGE_HOSTING_TYPE,
  MJX_DATA_FORMULA,
  MJX_DATA_FORMULA_TYPE,
  MAX_MD_NUMBER,
  THROTTLE_MATHJAX_TIME,
  THROTTLE_MD_RENDER_TIME,
} from "./utils/constant";
import {markdownParser, updateMathjax} from "./utils/helper";
import diagnoseMarkdown from "./utils/markdownDiagnostics";
import {diagnoseExamMarkdown, insertAnswerPlaceholders} from "./utils/examMarkdownDiagnostics";
import pluginCenter from "./utils/pluginCenter";
import appContext from "./utils/appContext";
import {uploadAdaptor} from "./utils/imageHosting";
import bindHotkeys, {betterTab, rightClick} from "./utils/hotkey";
import {message} from "antd";

@inject("content")
@inject("navbar")
@inject("footer")
@inject("view")
@inject("dialog")
@inject("imageHosting")
@observer
class App extends Component {
  constructor(props) {
    super(props);
    this.scale = 1;
    this.handleUpdateMathjax = throttle(updateMathjax, THROTTLE_MATHJAX_TIME);
    this.handleThrottleChange = throttle(this.handleChange, THROTTLE_MD_RENDER_TIME);
    this.state = {
      focus: false,
      diagnosticsOpen: false,
      examDiagnosticsOpen: false,
    };
  }

  componentDidMount() {
    document.addEventListener("fullscreenchange", this.solveScreenChange);
    document.addEventListener("webkitfullscreenchange", this.solveScreenChange);
    document.addEventListener("mozfullscreenchange", this.solveScreenChange);
    document.addEventListener("MSFullscreenChange", this.solveScreenChange);
    try {
      window.MathJax = {
        tex: {
          inlineMath: [["$", "$"]],
          displayMath: [["$$", "$$"]],
          tags: "ams",
        },
        svg: {
          fontCache: "none",
        },
        options: {
          renderActions: {
            addMenu: [0, "", ""],
            addContainer: [
              190,
              (doc) => {
                for (const math of doc.math) {
                  this.addContainer(math, doc);
                }
              },
              this.addContainer,
            ],
          },
        },
      };
      // eslint-disable-next-line
      require("mathjax/es5/tex-svg-full");
      pluginCenter.mathjax = true;
    } catch (e) {
      console.log(e);
    }
    this.setEditorContent();
    this.setCustomImageHosting();
  }

  componentDidUpdate() {
    if (pluginCenter.mathjax) {
      this.handleUpdateMathjax();
    }
  }

  componentWillUnmount() {
    document.removeEventListener("fullscreenchange", this.solveScreenChange);
    document.removeEventListener("webkitfullscreenchange", this.solveScreenChange);
    document.removeEventListener("mozfullscreenchange", this.solveScreenChange);
    document.removeEventListener("MSFullscreenChange", this.solveScreenChange);
  }

  setCustomImageHosting = () => {
    if (this.props.useImageHosting === undefined) {
      return;
    }
    const {url, name, isSmmsOpen, isQiniuyunOpen, isAliyunOpen, isGiteeOpen, isGitHubOpen} = this.props.useImageHosting;
    if (name) {
      this.props.imageHosting.setHostingUrl(url);
      this.props.imageHosting.setHostingName(name);
      this.props.imageHosting.addImageHosting(name);
    }
    if (isSmmsOpen) {
      this.props.imageHosting.addImageHosting(IMAGE_HOSTING_NAMES.smms);
    }
    if (isAliyunOpen) {
      this.props.imageHosting.addImageHosting(IMAGE_HOSTING_NAMES.aliyun);
    }
    if (isQiniuyunOpen) {
      this.props.imageHosting.addImageHosting(IMAGE_HOSTING_NAMES.qiniuyun);
    }
    if (isGiteeOpen) {
      this.props.imageHosting.addImageHosting(IMAGE_HOSTING_NAMES.gitee);
    }
    if (isGitHubOpen) {
      this.props.imageHosting.addImageHosting(IMAGE_HOSTING_NAMES.github);
    }

    // 第一次进入没有默认图床时
    if (window.localStorage.getItem(IMAGE_HOSTING_TYPE) === null) {
      let type;
      if (name) {
        type = name;
      } else if (isSmmsOpen) {
        type = IMAGE_HOSTING_NAMES.smms;
      } else if (isAliyunOpen) {
        type = IMAGE_HOSTING_NAMES.aliyun;
      } else if (isQiniuyunOpen) {
        type = IMAGE_HOSTING_NAMES.qiniuyun;
      } else if (isGiteeOpen) {
        type = IMAGE_HOSTING_NAMES.isGitee;
      }
      this.props.imageHosting.setType(type);
      window.localStorage.setItem(IMAGE_HOSTING_TYPE, type);
    }
  };

  setEditorContent = () => {
    const {defaultText} = this.props;
    if (defaultText) {
      this.props.content.setContent(defaultText);
    }
  };

  setCurrentIndex(index) {
    this.index = index;
  }

  solveScreenChange = () => {
    const {isImmersiveEditing} = this.props.view;
    this.props.view.setImmersiveEditing(!isImmersiveEditing);
  };

  getInstance = (instance) => {
    instance.editor.on("inputRead", function(cm, event) {
      if (event.origin === "paste") {
        var text = event.text[0]; // pasted string
        var new_text = ""; // any operations here
        cm.refresh();
        const {length} = cm.getSelections();
        // my first idea was
        // note: for multiline strings may need more complex calculations
        cm.replaceRange(new_text, event.from, {line: event.from.line, ch: event.from.ch + text.length});
        // first solution did'nt work (before i guess to call refresh) so i tried that way, works too
        if (length === 1) {
          cm.execCommand("undo");
        }
        // cm.setCursor(event.from);
        cm.replaceSelection(new_text);
      }
    });
    if (instance) {
      this.props.content.setMarkdownEditor(instance.editor);
    }
  };

  handleScroll = () => {
    if (this.props.navbar.isSyncScroll) {
      const {markdownEditor} = this.props.content;
      const cmData = markdownEditor.getScrollInfo();
      const editorToTop = cmData.top;
      const editorScrollHeight = cmData.height - cmData.clientHeight;
      this.scale = (this.previewWrap.offsetHeight - this.previewContainer.offsetHeight + 55) / editorScrollHeight;
      if (this.index === 1) {
        this.previewContainer.scrollTop = editorToTop * this.scale;
      } else {
        this.editorTop = this.previewContainer.scrollTop / this.scale;
        markdownEditor.scrollTo(null, this.editorTop);
      }
    }
  };

  handleChange = (editor) => {
    if (this.state.focus) {
      const content = editor.getValue();
      if (content.length > MAX_MD_NUMBER) {
        message.error(`字符数超过 ${MAX_MD_NUMBER}`);
        return;
      }
      this.props.content.setContent(content);
      this.props.onTextChange && this.props.onTextChange(content);
    }
  };

  handleFocus = (editor) => {
    this.setState({
      focus: true,
    });
    this.props.onTextFocus && this.props.onTextFocus(editor.getValue());
  };

  handleBlur = (editor) => {
    this.setState({
      focus: false,
    });
    this.props.onTextBlur && this.props.onTextBlur(editor.getValue());
  };

  toggleDiagnostics = () => {
    this.setState((state) => ({
      diagnosticsOpen: !state.diagnosticsOpen,
    }));
  };

  toggleExamDiagnostics = () => {
    this.setState((state) => ({
      examDiagnosticsOpen: !state.examDiagnosticsOpen,
    }));
  };

  fillExamAnswerPlaceholders = () => {
    const nextContent = insertAnswerPlaceholders(this.props.content.content);
    this.props.content.setContent(nextContent);
    if (this.props.content.markdownEditor) {
      this.props.content.markdownEditor.setValue(nextContent);
    }
    this.props.onTextChange && this.props.onTextChange(nextContent);
  };

  getStyleInstance = (instance) => {
    if (instance) {
      this.styleEditor = instance.editor;
      this.styleEditor.on("keyup", (cm, e) => {
        if ((e.keyCode >= 65 && e.keyCode <= 90) || e.keyCode === 189) {
          cm.showHint(e);
        }
      });
    }
  };

  handleDrop = (instance, e) => {
    // e.preventDefault();
    // console.log(e.dataTransfer.files[0]);
    if (!(e.dataTransfer && e.dataTransfer.files)) {
      return;
    }
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      // console.log(e.dataTransfer.files[i]);
      uploadAdaptor({file: e.dataTransfer.files[i], content: this.props.content});
    }
  };

  handlePaste = (instance, e) => {
    const cbData = e.clipboardData;

    const insertPasteContent = (cm, content) => {
      const {length} = cm.getSelections();
      cm.replaceSelections(Array(length).fill(content));
      this.setState(
        {
          focus: true,
        },
        () => {
          this.handleThrottleChange(cm);
        },
      );
    };

    if (e.clipboardData && e.clipboardData.files) {
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        uploadAdaptor({file: e.clipboardData.files[i], content: this.props.content});
      }
    }

    if (cbData) {
      const html = cbData.getData("text/html");
      const text = cbData.getData("TEXT");
      insertPasteContent(instance, text);
      if (html) {
        this.props.footer.setPasteHtmlChecked(true);
        this.props.footer.setPasteHtml(html);
        this.props.footer.setPasteText(text);
      } else {
        this.props.footer.setPasteHtmlChecked(false);
      }
    }
  };

  addContainer(math, doc) {
    const tag = "span";
    const spanClass = math.display ? "span-block-equation" : "span-inline-equation";
    const cls = math.display ? "block-equation" : "inline-equation";
    math.typesetRoot.className = cls;
    math.typesetRoot.setAttribute(MJX_DATA_FORMULA, math.math);
    math.typesetRoot.setAttribute(MJX_DATA_FORMULA_TYPE, cls);
    math.typesetRoot = doc.adaptor.node(tag, {class: spanClass, style: "cursor:pointer"}, [math.typesetRoot]);
  }

  render() {
    const {previewType} = this.props.navbar;
    const {isEditAreaOpen, isPreviewAreaOpen, isStyleEditorOpen, isImmersiveEditing} = this.props.view;
    const {isExamDiagnosticsEnabled} = this.props.view;
    const {isSearchOpen} = this.props.dialog;

    const {content} = this.props.content;
    const parseHtml = markdownParser.render(content);
    const diagnostics = diagnoseMarkdown(content);
    const examDiagnostics = isExamDiagnosticsEnabled ? diagnoseExamMarkdown(content) : [];
    const diagnosticsToggleText = `可能的 Markdown 渲染问题（${diagnostics.length}）${
      this.state.diagnosticsOpen ? "收起" : "展开"
    }`;
    const examErrorCount = examDiagnostics.filter((item) => item.severity === "error").length;
    const examWarningCount = examDiagnostics.length - examErrorCount;
    const examDiagnosticsToggleText = `试卷 Markdown 检查（${examErrorCount} 错 / ${examWarningCount} 提示）${
      this.state.examDiagnosticsOpen ? "收起" : "展开"
    }`;

    const mdEditingClass = classnames({
      "nice-md-editing": !isImmersiveEditing,
      "nice-md-editing-immersive": isImmersiveEditing,
      "nice-md-editing-hide": !isEditAreaOpen,
    });

    const styleEditingClass = classnames({
      "nice-style-editing": true,
      "nice-style-editing-hide": isImmersiveEditing,
    });

    const richTextClass = classnames({
      "nice-marked-text": true,
      "nice-marked-text-pc": previewType === "pc",
      "nice-marked-text-hide": isImmersiveEditing || !isPreviewAreaOpen,
    });

    const richTextBoxClass = classnames({
      "nice-wx-box": true,
      "nice-wx-box-pc": previewType === "pc",
    });

    const textContainerClass = classnames({
      "nice-text-container": !isImmersiveEditing,
      "nice-text-container-immersive": isImmersiveEditing,
    });

    return (
      <appContext.Consumer>
        {({defaultTitle, onStyleChange, onStyleBlur, onStyleFocus, token}) => (
          <div className="nice-app">
            <Navbar title={defaultTitle} token={token} />
            <div className={textContainerClass}>
              <div id="nice-md-editor" className={mdEditingClass} onMouseOver={(e) => this.setCurrentIndex(1, e)}>
                {isSearchOpen && <SearchBox />}
                <CodeMirror
                  value={content}
                  options={{
                    theme: "md-mirror",
                    keyMap: "sublime",
                    mode: "markdown",
                    lineWrapping: true,
                    lineNumbers: true,
                    extraKeys: {
                      ...bindHotkeys(this.props.content, this.props.dialog),
                      Tab: betterTab,
                      RightClick: rightClick,
                    },
                  }}
                  onChange={this.handleThrottleChange}
                  onScroll={this.handleScroll}
                  onFocus={this.handleFocus}
                  onBlur={this.handleBlur}
                  onDrop={this.handleDrop}
                  onPaste={this.handlePaste}
                  ref={this.getInstance}
                />
                {diagnostics.length > 0 && (
                  <div
                    className={`nice-markdown-diagnostics ${
                      this.state.diagnosticsOpen ? "" : "nice-markdown-diagnostics-collapsed"
                    }`}
                  >
                    <button className="nice-markdown-diagnostics-title" type="button" onClick={this.toggleDiagnostics}>
                      {diagnosticsToggleText}
                    </button>
                    {this.state.diagnosticsOpen && (
                      <div>
                        {diagnostics.slice(0, 6).map((diagnostic, index) => (
                          <div
                            className="nice-markdown-diagnostics-item"
                            key={`${diagnostic.line}-${diagnostic.column}-${index}`}
                          >
                            {`第 ${diagnostic.line} 行，第 ${diagnostic.column} 列：${diagnostic.message}`}
                          </div>
                        ))}
                        {diagnostics.length > 6 && (
                          <div className="nice-markdown-diagnostics-more">
                            {`还有 ${diagnostics.length - 6} 个问题未显示`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {isExamDiagnosticsEnabled && (
                  <div
                    className={`nice-exam-diagnostics ${
                      this.state.examDiagnosticsOpen ? "" : "nice-exam-diagnostics-collapsed"
                    }`}
                  >
                    <button
                      className="nice-markdown-diagnostics-title"
                      type="button"
                      onClick={this.toggleExamDiagnostics}
                    >
                      {examDiagnosticsToggleText}
                    </button>
                    {this.state.examDiagnosticsOpen && (
                      <div>
                        <div className="nice-exam-diagnostics-actions">
                          <button
                            className="nice-exam-diagnostics-action"
                            type="button"
                            onClick={this.fillExamAnswerPlaceholders}
                          >
                            生成缺失答案槽位
                          </button>
                        </div>
                        {examDiagnostics.slice(0, 8).map((diagnostic, index) => (
                          <div
                            className={`nice-markdown-diagnostics-item nice-exam-diagnostics-${diagnostic.severity}`}
                            key={`${diagnostic.line}-${diagnostic.column}-${index}`}
                          >
                            {`第 ${diagnostic.line} 行，第 ${diagnostic.column} 列：${diagnostic.message}`}
                          </div>
                        ))}
                        {examDiagnostics.length === 0 && (
                          <div className="nice-markdown-diagnostics-item">未发现标准试卷 Markdown 结构问题。</div>
                        )}
                        {examDiagnostics.length > 8 && (
                          <div className="nice-markdown-diagnostics-more">
                            {`还有 ${examDiagnostics.length - 8} 个问题未显示`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div id="nice-rich-text" className={richTextClass} onMouseOver={(e) => this.setCurrentIndex(2, e)}>
                <Sidebar />
                <div
                  id={BOX_ID}
                  className={richTextBoxClass}
                  onScroll={this.handleScroll}
                  ref={(node) => {
                    this.previewContainer = node;
                  }}
                >
                  <section
                    id={LAYOUT_ID}
                    data-tool="mdnice编辑器"
                    data-website="https://www.mdnice.com"
                    dangerouslySetInnerHTML={{
                      __html: parseHtml,
                    }}
                    ref={(node) => {
                      this.previewWrap = node;
                    }}
                  />
                </div>
              </div>

              {isStyleEditorOpen && (
                <div id="nice-style-editor" className={styleEditingClass}>
                  <StyleEditor onStyleChange={onStyleChange} onStyleBlur={onStyleBlur} onStyleFocus={onStyleFocus} />
                </div>
              )}

              <Dialog />
              <EditorMenu />
            </div>
            <Footer />
          </div>
        )}
      </appContext.Consumer>
    );
  }
}

export default App;
