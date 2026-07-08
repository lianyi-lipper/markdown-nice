import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {Modal, Button} from "antd";

@inject("dialog")
@observer
class AboutDialog extends Component {
  handleOk = () => {
    this.props.dialog.setAboutOpen(false);
  };

  handleCancel = () => {
    this.props.dialog.setAboutOpen(false);
  };

  handleVersion = () => {
    this.props.dialog.setAboutOpen(false);
    this.props.dialog.setVersionOpen(true);
  };

  render() {
    return (
      <Modal
        title="关于"
        okText="确认"
        cancelText="取消"
        visible={this.props.dialog.isAboutOpen}
        onOk={this.handleOk}
        onCancel={this.handleCancel}
        footer={[
          <Button key="version" onClick={this.handleVersion}>
            更新记录
          </Button>,
          <Button key="submit" type="primary" onClick={this.handleOk}>
            确认
          </Button>,
        ]}
        bodyStyle={{
          paddingTop: "5px",
        }}
      >
        <h3 style={style.headerMargin}>Markdown Nice Local</h3>
        <p style={style.lineHeight}>支持自定义样式的 Markdown 编辑器；</p>
        <p style={style.lineHeight}>支持微信公众号、知乎和稀土掘金；</p>
        <p style={style.lineHeight}>
          当前版本是基于 Markdown Nice 的本地自用 fork，去除了默认推广入口并增加了本地辅助检查。
        </p>
        <h3 style={style.headerMargin}>来源</h3>
        <p style={style.lineHeight}>
          原项目：
          <a
            id="nice-about-dialog-github"
            rel="noopener noreferrer"
            target="_blank"
            href="https://github.com/mdnice/markdown-nice"
          >
            Markdown Nice
          </a>
          。请保留 GPL-3.0 许可证和原项目来源信息。
        </p>
      </Modal>
    );
  }
}

const style = {
  headerMargin: {
    marginTop: "5px",
    marginBottom: "5px",
    color: "black",
  },
  lineHeight: {
    lineHeight: "26px",
    color: "black",
    padding: 0,
    margin: 0,
  },
};

export default AboutDialog;
