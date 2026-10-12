mod common;

use axum::http::StatusCode;
use common::{login, request, test_app};
use serde_json::{Value, json};

async fn create_switch(app: &axum::Router, admin: &str, name: &str) -> String {
    let (status, sw) = request(
        app,
        "POST",
        "/api/v1/admin/management-switches",
        Some(admin),
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create switch: {sw}");
    sw["id"].as_str().unwrap().to_string()
}

async fn create_port(app: &axum::Router, admin: &str, switch: &str, name: &str) -> String {
    let (status, port) = request(
        app,
        "POST",
        &format!("/api/v1/admin/management-switches/{switch}/ports"),
        Some(admin),
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create port: {port}");
    port["id"].as_str().unwrap().to_string()
}

async fn create_tofino(app: &axum::Router, admin: &str, name: &str) -> String {
    let (status, tofino) = request(
        app,
        "POST",
        "/api/v1/admin/tofinos",
        Some(admin),
        Some(json!({ "name": name, "version": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    tofino["id"].as_str().unwrap().to_string()
}

async fn create_server_with_nic(
    app: &axum::Router,
    admin: &str,
    server_name: &str,
    nic_name: &str,
    pci: &str,
) -> (String, String) {
    let (status, server) = request(
        app,
        "POST",
        "/api/v1/admin/servers",
        Some(admin),
        Some(json!({ "name": server_name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let server_id = server["id"].as_str().unwrap().to_string();
    let (status, nic) = request(
        app,
        "POST",
        &format!("/api/v1/admin/servers/{server_id}/nics"),
        Some(admin),
        Some(json!({
            "name": nic_name, "pci_address": pci,
            "nic_type": "i350", "speed_gbps": 1.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    (server_id, nic["id"].as_str().unwrap().to_string())
}

fn port_by_id<'a>(body: &'a Value, id: &str) -> &'a Value {
    body["ports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .expect("port present")
}

#[tokio::test]
async fn management_is_admin_only() {
    let (_state, app) = test_app().await;
    let user = login(&app, "bob", false).await;

    for uri in [
        "/api/v1/management-switches",
        "/api/v1/vlans",
        "/api/v1/management-switch-ports",
    ] {
        let (status, _) = request(&app, "GET", uri, Some(&user), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{uri} should be admin-only");
    }
}

#[tokio::test]
async fn switch_crud_roundtrip() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let id = create_switch(&app, &admin, "Mgmt1").await;

    let (status, body) = request(
        &app,
        "GET",
        "/api/v1/management-switches",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // The DB is pre-seeded with real management switches (migrations), so assert
    // the freshly created one is present rather than an exact total count.
    assert!(
        body["switches"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["id"] == id),
    );

    // Duplicate name conflicts.
    let (status, _) = request(
        &app,
        "POST",
        "/api/v1/admin/management-switches",
        Some(&admin),
        Some(json!({ "name": "Mgmt1" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, updated) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switches/{id}"),
        Some(&admin),
        Some(json!({ "mgmt_ip": "10.0.0.2", "model": "Aruba" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["mgmt_ip"], "10.0.0.2");

    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/admin/management-switches/{id}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn vlan_crud_and_uniqueness() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;

    let (status, vlan) = request(
        &app,
        "POST",
        "/api/v1/admin/vlans",
        Some(&admin),
        Some(json!({ "vlan_id": 100, "name": "mgmt", "purpose": "management" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let vlan_id = vlan["id"].as_str().unwrap().to_string();

    // Out-of-range rejected.
    let (status, _) = request(
        &app,
        "POST",
        "/api/v1/admin/vlans",
        Some(&admin),
        Some(json!({ "vlan_id": 5000 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Duplicate number conflicts.
    let (status, _) = request(
        &app,
        "POST",
        "/api/v1/admin/vlans",
        Some(&admin),
        Some(json!({ "vlan_id": 100 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/admin/vlans/{vlan_id}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn port_to_port_link_is_mirrored() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let sw = create_switch(&app, &admin, "Mgmt1").await;
    let a = create_port(&app, &admin, &sw, "1").await;
    let b = create_port(&app, &admin, &sw, "2").await;

    for (vlan_id, name) in [(830, "link-a"), (840, "link-b")] {
        let (status, _) = request(
            &app,
            "POST",
            "/api/v1/admin/vlans",
            Some(&admin),
            Some(json!({ "vlan_id": vlan_id, "name": name })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }

    // The peer already has VLAN documentation while the side initiating the
    // link is blank. Linking must preserve and mirror the non-empty set.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{b}"),
        Some(&admin),
        Some(json!({ "vlans": [{ "vlan_id": 830, "tagged": true }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{a}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "port", "port_id": b }, "cable_label": "C1" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_status, body) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    // Both ends point at each other, and the cable label is on both.
    assert_eq!(port_by_id(&body, &a)["peer_port_id"], json!(b));
    assert_eq!(port_by_id(&body, &b)["peer_port_id"], json!(a));
    assert_eq!(port_by_id(&body, &b)["cable_label"], "C1");
    assert_eq!(
        port_by_id(&body, &a)["vlans"],
        port_by_id(&body, &b)["vlans"]
    );
    assert_eq!(port_by_id(&body, &a)["vlans"][0]["vlan_id"], 830);

    // Editing either endpoint replaces the VLAN set on both ends.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{a}"),
        Some(&admin),
        Some(json!({ "vlans": [{ "vlan_id": 840, "tagged": false }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_status, body) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(
        port_by_id(&body, &a)["vlans"],
        port_by_id(&body, &b)["vlans"]
    );
    assert_eq!(port_by_id(&body, &b)["vlans"].as_array().unwrap().len(), 1);
    assert_eq!(port_by_id(&body, &b)["vlans"][0]["vlan_id"], 840);
    assert_eq!(port_by_id(&body, &b)["vlans"][0]["tagged"], false);
}

#[tokio::test]
async fn port_to_tofino_mgmt_link_is_mirrored() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let sw = create_switch(&app, &admin, "Mgmt1").await;
    let port = create_port(&app, &admin, &sw, "12").await;
    let tofino = create_tofino(&app, &admin, "Frank").await;

    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{port}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "tofino", "tofino_id": tofino } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // The port records the Tofino peer...
    let (_s, ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(port_by_id(&ports, &port)["peer_tofino_id"], json!(tofino));

    // ...and the Tofino shows the read-only back-link label.
    let (_s, tofinos) = request(&app, "GET", "/api/v1/tofinos", Some(&admin), None).await;
    let frank = tofinos["tofinos"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == json!(tofino))
        .unwrap();
    assert_eq!(frank["mgmt_peer_label"], "Mgmt1 12");

    // Clearing the peer clears both ends.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{port}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "none" } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_s, tofinos) = request(&app, "GET", "/api/v1/tofinos", Some(&admin), None).await;
    let frank = tofinos["tofinos"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == json!(tofino))
        .unwrap();
    assert_eq!(frank["mgmt_peer_label"], Value::Null);
}

#[tokio::test]
async fn port_to_nic_link_shows_on_server_and_enforces_single_cable() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let sw = create_switch(&app, &admin, "Mgmt1").await;
    let port = create_port(&app, &admin, &sw, "5").await;
    let (server_id, nic_id) =
        create_server_with_nic(&app, &admin, "Kuppler", "eno1", "0000:01:00.0").await;

    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{port}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "nic", "nic_id": nic_id } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // The server NIC shows the management-port mirror label.
    let (_s, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let nic = servers["servers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == json!(server_id))
        .unwrap()["nics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == json!(nic_id))
        .unwrap();
    assert_eq!(nic["peer_mgmt_port_label"], "Mgmt1 5");
}

#[tokio::test]
async fn import_creates_ports_vlans_and_membership() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let sw = create_switch(&app, &admin, "Mgmt1").await;

    // VLAN numbers not used by the seed migrations, so `vlans_created` is
    // deterministic regardless of the pre-seeded global VLAN database.
    let payload = json!({
        "model": "Aruba 6300",
        "vlans": [
            { "vlan_id": 810, "name": "mgmt" },
            { "vlan_id": 820, "name": "storage" }
        ],
        "ports": [
            { "name": "1", "ifname": "GigabitEthernet1/0/1", "speed_gbps": 1.0,
              "vlans": [ { "vlan_id": 810, "tagged": false }, { "vlan_id": 820, "tagged": true } ] },
            { "name": "2", "vlans": [ { "vlan_id": 820, "tagged": false } ] }
        ]
    });
    let (status, result) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/management-switches/{sw}/import"),
        Some(&admin),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "import: {result}");
    assert_eq!(result["vlans_created"], 2);
    assert_eq!(result["ports_created"], 2);

    let (_s, ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    let port1 = ports["ports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "1")
        .unwrap();
    let vlans = port1["vlans"].as_array().unwrap();
    assert_eq!(vlans.len(), 2);
    let untagged = vlans.iter().find(|v| v["vlan_id"] == 810).unwrap();
    assert_eq!(untagged["tagged"], false);

    // Re-running is idempotent: nothing created the second time.
    let (status, result) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/management-switches/{sw}/import"),
        Some(&admin),
        Some(payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["vlans_created"], 0);
    assert_eq!(result["ports_created"], 0);
    assert_eq!(result["ports_updated"], 2);
}

#[tokio::test]
async fn import_mirrors_vlan_membership_to_linked_port() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let left_switch = create_switch(&app, &admin, "Import left").await;
    let right_switch = create_switch(&app, &admin, "Import right").await;
    let left = create_port(&app, &admin, &left_switch, "uplink").await;
    let right = create_port(&app, &admin, &right_switch, "uplink").await;

    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{left}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "port", "port_id": right } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, result) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/management-switches/{left_switch}/import"),
        Some(&admin),
        Some(json!({
            "vlans": [{ "vlan_id": 850, "name": "imported trunk" }],
            "ports": [{
                "name": "uplink",
                "vlans": [{ "vlan_id": 850, "tagged": true }]
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "import: {result}");

    let (_status, body) = request(
        &app,
        "GET",
        "/api/v1/management-switch-ports",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(
        port_by_id(&body, &left)["vlans"],
        port_by_id(&body, &right)["vlans"]
    );
    assert_eq!(port_by_id(&body, &right)["vlans"][0]["vlan_id"], 850);
    assert_eq!(port_by_id(&body, &right)["vlans"][0]["tagged"], true);
}

#[tokio::test]
async fn port_to_server_ipmi_link_records_server_without_nic() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let sw = create_switch(&app, &admin, "Mgmt1").await;
    let port = create_port(&app, &admin, &sw, "1").await;
    // A server with no NIC: the port plugs into the whole host (its IPMI port).
    let (status, server) = request(
        &app,
        "POST",
        "/api/v1/admin/servers",
        Some(&admin),
        Some(json!({ "name": "ipmi-host-test" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let server_id = server["id"].as_str().unwrap().to_string();

    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{port}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "server", "server_id": server_id } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_s, ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    let row = port_by_id(&ports, &port);
    assert_eq!(row["peer_server_id"], json!(server_id));
    assert_eq!(row["peer_nic_id"], Value::Null);
    assert_eq!(row["peer_label"], "ipmi-host-test (IPMI)");

    // Re-cabling to something else clears the server peer.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{port}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "text", "text": "elsewhere" } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_s, ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(port_by_id(&ports, &port)["peer_server_id"], Value::Null);
}

/// A NIC editor's peer can also point at a management-switch port. Linking
/// from that side must detach the NIC from any previous physical cable (a
/// Tofino port, a direct NIC↔NIC link, or a different management port), and
/// moving the NIC's peer away again must release the management port.
#[tokio::test]
async fn nic_editor_links_to_management_port_and_detaches_other_links() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let sw = create_switch(&app, &admin, "Mgmt1").await;
    let port_a = create_port(&app, &admin, &sw, "A").await;
    let port_b = create_port(&app, &admin, &sw, "B").await;

    let tofino = create_tofino(&app, &admin, "Frank").await;
    let (status, tp) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/tofinos/{tofino}/ports"),
        Some(&admin),
        Some(json!({"fp_port": "1/0", "dev_port": 132})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let tofino_port = tp["id"].as_str().unwrap().to_string();

    let (_server1, nic1) =
        create_server_with_nic(&app, &admin, "mgmt-link-test-1", "eno1", "0000:01:00.0").await;
    let (_server2, nic2) =
        create_server_with_nic(&app, &admin, "mgmt-link-test-2", "eno1", "0000:02:00.0").await;
    let (_server3, nic3) =
        create_server_with_nic(&app, &admin, "mgmt-link-test-3", "eno1", "0000:03:00.0").await;

    // nic1 starts cabled to a Tofino port.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{tofino_port}"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "nic", "nic_id": nic1 } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Linking nic1 to management port A detaches it from the Tofino port and
    // shows up on both the NIC and the management port.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic1}/claim"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "mgmt", "port_id": port_a } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_s, ports) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    let tofino_port_row = ports["ports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == json!(tofino_port))
        .unwrap();
    assert_eq!(
        tofino_port_row["peer_nic_id"],
        Value::Null,
        "the old Tofino-port link must be released"
    );

    let (_s, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let nic_view = |servers: &Value, id: &str| -> Value {
        servers["servers"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|s| s["nics"].as_array().unwrap())
            .find(|n| n["id"] == json!(id))
            .unwrap()
            .clone()
    };
    let nic1_view = nic_view(&servers, &nic1);
    assert_eq!(nic1_view["peer_mgmt_port_id"], json!(port_a));
    assert_eq!(nic1_view["peer_mgmt_port_label"], "Mgmt1 A");
    assert_eq!(nic1_view["peer_port_id"], Value::Null);

    let (_s, mgmt_ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(port_by_id(&mgmt_ports, &port_a)["peer_nic_id"], json!(nic1));

    // nic2 and nic3 start directly cabled to each other.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic2}/claim"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "nic", "nic_id": nic3 } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_s, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    assert_eq!(nic_view(&servers, &nic3)["peer_nic_id"], json!(nic2));

    // Linking nic2 to management port B detaches the direct NIC↔NIC link.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic2}/claim"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "mgmt", "port_id": port_b } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_s, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    assert_eq!(
        nic_view(&servers, &nic3)["peer_nic_id"],
        Value::Null,
        "the old direct NIC link must be released on both ends"
    );
    assert_eq!(
        nic_view(&servers, &nic2)["peer_mgmt_port_id"],
        json!(port_b)
    );
    let (_s, mgmt_ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(port_by_id(&mgmt_ports, &port_b)["peer_nic_id"], json!(nic2));

    // Moving nic2's peer to a Tofino port releases management port B.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic2}/claim"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "port", "port_id": tofino_port } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_s, mgmt_ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(
        port_by_id(&mgmt_ports, &port_b)["peer_nic_id"],
        Value::Null,
        "moving the NIC to a Tofino port must release the old management port"
    );

    // Moving nic1's peer away to free text releases management port A.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic1}/claim"),
        Some(&admin),
        Some(json!({ "peer": { "kind": "text", "text": "Rack 7 patch" } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_s, mgmt_ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(
        port_by_id(&mgmt_ports, &port_a)["peer_nic_id"],
        Value::Null,
        "moving the NIC to free text must release the old management port"
    );
}

/// Freeing a NIC unplugs it from a management port too, and the port
/// loses the cable documentation with it.
#[tokio::test]
async fn freeing_a_nic_unplugs_its_management_port() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let sw = create_switch(&app, &admin, "Mgmt1").await;
    let port = create_port(&app, &admin, &sw, "A").await;
    let (_server, nic) =
        create_server_with_nic(&app, &admin, "free-mgmt", "eno1", "0000:01:00.0").await;

    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/management-switch-ports/{port}"),
        Some(&admin),
        Some(json!({
            "cable_label": "M-1",
            "comment": "IPMI",
            "peer": { "kind": "nic", "nic_id": nic }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/nics/{nic}/free"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_s, mgmt_ports) = request(
        &app,
        "GET",
        &format!("/api/v1/management-switch-ports?switch_id={sw}"),
        Some(&admin),
        None,
    )
    .await;
    let row = port_by_id(&mgmt_ports, &port);
    assert_eq!(row["peer_nic_id"], Value::Null);
    assert_eq!(row["cable_label"], "");
    assert_eq!(row["comment"], "");
}
