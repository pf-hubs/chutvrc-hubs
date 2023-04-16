/* eslint-disable react/prop-types */
/* eslint-disable @calm/react-intl/missing-formatted-message*/

import React, { Component } from "react";
import { connect } from "react-redux";
import { RoomEditToolbar } from "./room-edit-toolbar";
import { withStyles } from "@material-ui/core/styles";

import {
  BooleanField,
  BooleanInput,
  Datagrid,
  DateField,
  Edit,
  EditButton,
  Filter,
  FunctionField,
  List,
  SelectInput,
  SimpleForm,
  TextField,
  TextInput,
  refreshView
} from "react-admin";

const sfuList = ["sora", "dialog"];

const styles = {
  hide: { display: "none" },
  noBorder: { border: "0px" },
  searchCard: { marginBottom: "5px" }
};

const RoomFilter = props => (
  <Filter {...props}>
    <TextInput label="Search Name" source="name" alwaysOn />
    <TextInput label="Search SID" source="hub_sid" alwaysOn />
  </Filter>
);

export const RoomList = withStyles(styles)(
  connect(undefined, { refreshView })(
    class RoomList extends Component {
      state = {
        emailSearch: "",
        searching: false,
        searchStatus: null,
        batchCreate: "",
        creating: false,
        createStatus: null,
        createResults: ""
      };
      componentWillUnmount() {
        this.clearCreateStatusTimer();
        this.clearSearchStatusTimer();
      }
      clearCreateStatusTimer() {
        if (this.createStatusTimer) {
          clearTimeout(this.createStatusTimer);
          this.createStatusTimer = null;
        }
      }
      clearSearchStatusTimer() {
        if (this.searchStatusTimer) {
          clearTimeout(this.searchStatusTimer);
          this.searchStatusTimer = null;
        }
      }
      async onAccountSearch(e) {
        e.preventDefault();
        this.setState({ searching: true, searchStatus: null });
        const result = await fetch("/api/v1/accounts/search", {
          method: "post",
          headers: {
            "content-type": "application/json",
            authorization: `bearer ${window.APP.store.state.credentials.token}`
          },
          body: JSON.stringify({ email: this.state.emailSearch || "" })
        }).then(r => r.json());
        if (result && result.data) {
          window.location = `#/accounts/${result.data[0].id}`;
        } else {
          this.setState({ searching: false, searchStatus: "Account not found" });
        }
        // Quickfix snackbar component does not always close
        // Setting snackbar message to empty string closes
        this.clearSearchStatusTimer();
        this.searchStatusTimer = setTimeout(() => {
          this.setState({ searchStatus: "" });
          this.searchStatusTimer = null;
        }, 6000);
      }
      async onCreateAccount(e) {
        e.preventDefault();
        if (this.state.batchCreate.length === 0) return;
        this.setState({ creating: true, createStatus: null });
        const data = this.state.batchCreate
          .split(";") // ['email1,identity1', '', 'email2','email3,identity with spaces', 'email4']
          .filter(accounts => accounts !== "")
          .map(accounts => {
            const emailAndIdentity = accounts.split(",");
            return emailAndIdentity.length === 1
              ? {
                  email: emailAndIdentity[0].trim()
                }
              : {
                  email: emailAndIdentity[0].trim(),
                  name: emailAndIdentity[1].trim()
                };
          });
        const result = await fetch("/api/v1/accounts", {
          method: "post",
          headers: {
            "content-type": "application/json",
            authorization: `bearer ${window.APP.store.state.credentials.token}`
          },
          body: JSON.stringify({
            data: data.length === 1 ? data[0] : data
          })
        }).then(r => r.json());
        if (result && result.data) {
          // one email added successfully
          this.setState({ creating: false, createStatus: `Account created successfully` });
        } else if (result && result.errors) {
          // one email has errors
          this.setState({ creating: false, createStatus: result.errors[0].detail });
        } else if (Array.isArray(result)) {
          // Multiple email accounts created
          // results = {
          //   'successMsg': [email1, ..., email3],
          //   'errorMsg1': [email4],
          //   'errorMsg2': [email5, email6]
          // }
          const results = {};
          let isAllSuccess = true;
          let hasOneSuccess = false;
          result.forEach((emailResponse, index) => {
            isAllSuccess = isAllSuccess && emailResponse.status === 200;
            hasOneSuccess = hasOneSuccess || emailResponse.status === 200;
            const message =
              emailResponse.status === 200 ? "Created accounts successfully" : emailResponse.body.errors[0].detail;
            const email = data[index].email;
            if (results[message]) results[message].push(email);
            else results[message] = [email];
          });
          this.setState({
            creating: false,
            createStatus: isAllSuccess
              ? "Success adding all accounts"
              : hasOneSuccess
              ? "Success adding some accounts, Errors adding some accounts"
              : "Errors adding all accounts",
            createResults: results
          });
        }
        this.props.refreshView();
        // Quickfix snackbar component does not always close
        // Setting snackbar message to empty string closes
        this.clearCreateStatusTimer();
        this.createStatusTimer = setTimeout(() => {
          this.setState({ createStatus: "" });
          this.createStatusTimer = null;
        }, 6000);
      }
      render() {
        // refreshView() is only needed in onCreateAccounts()
        // eslint-disable-next-line no-unused-vars
        const { classes, refreshView, ...other } = this.props;
        return (
          <List {...other} filters={<RoomFilter />} bulkActionButtons={false}>
            <Datagrid>
              <TextField source="id" />
              <TextField source="hub_sid" />
              <TextField source="slug" />
              <TextField source="name" />
              <DateField source="inserted_at" />
              <DateField source="updated_at" />
              <TextField source="max_occupant_count" />
              <TextField source="entry_mode" />
              <TextField source="scene_id" />
              <TextField source="last_active_at" />
              <TextField source="member_permissions" />
              <BooleanField source="allow_promotion" />
              <TextField source="description" />
              <TextField source="room_size" />
              <FunctionField label="SFU" render={record => sfuList[record.sfu]} />
              <EditButton />
            </Datagrid>
          </List>
        );
      }
    }
  )
);

export const RoomEdit = withStyles(styles)(props => {
  return (
    <Edit {...props}>
      <SimpleForm toolbar={<RoomEditToolbar {...props} />}>
        <TextField label="Room SID" source="hub_sid" />
        <TextField label="Room Name" source="name" />
        <TextField label="Room Slug" source="slug" />
        <TextInput source="description" />
        <TextInput source="member_permissions" />
        <TextInput source="room_size" />
        <BooleanInput source="allow_promotion" />
        <SelectInput
          source="entry_mode"
          choices={[
            { id: "allow", name: "allow" },
            { id: "deny", name: "deny" }
          ]}
        />
        <SelectInput
          source="sfu"
          choices={[
            { id: 0, name: "Sora" },
            { id: 1, name: "Dialog (Mediasoup-based)" }
          ]}
        />
      </SimpleForm>
    </Edit>
  );
});
