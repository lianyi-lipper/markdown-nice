import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {Modal, Timeline, Button} from "antd";

import "./VersionDialog.css";

@inject("dialog")
@observer
class VersionDialog extends Component {
  constructor(props) {
    super(props);
    this.state = {
      versionTimeline: [
        "本地 fork 更新",
        "新增 Markdown 渲染诊断",
        "新增可选试卷 Markdown 检查",
        "移除默认远程推广入口",
      ],
    };
  }

  handleOk = () => {
    this.props.dialog.setVersionOpen(false);
  };

  handleCancel = () => {
    this.props.dialog.setVersionOpen(false);
  };

  render() {
    return (
      <Modal
        title="版本更新"
        visible={this.props.dialog.isVersionOpen}
        onOk={this.handleOk}
        onCancel={this.handleCancel}
        footer={[
          <Button key="submit" type="primary" onClick={this.handleOk}>
            确认
          </Button>,
        ]}
        destroyOnClose
      >
        <Timeline>
          {this.state.versionTimeline.map((version, index) => {
            if (index === 0) {
              return (
                <Timeline.Item key={index}>
                  <strong>{version}</strong>
                </Timeline.Item>
              );
            } else {
              return <Timeline.Item key={index}>{version}</Timeline.Item>;
            }
          })}
        </Timeline>
      </Modal>
    );
  }
}

export default VersionDialog;
