import React, {Component} from "react";
import {inject, observer} from "mobx-react";

@inject("dialog")
@observer
class ImportNotion extends Component {
  render() {
    return (
      <button
        type="button"
        className="nice-menu-item"
        id="nice-menu-import-notion"
        onClick={() => this.props.dialog.setNotionOpen(true)}
      >
        <span>
          <span className="nice-menu-flag" />
          <span className="nice-menu-name">从 Notion 导入</span>
        </span>
      </button>
    );
  }
}

export default ImportNotion;
