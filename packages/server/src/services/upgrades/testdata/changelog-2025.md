---
sidebar_label: 2025
---

# 2025 Changelog

### ClickHouse release 25.11, 2025-11-27 {#2511}

#### Backward Incompatible Change
* Remove deprecated `Object` type. [#85718](https://github.com/ClickHouse/ClickHouse/pull/85718) ([Pavel Kruglov](https://github.com/Avogar)).
* Remove the obsolete `LIVE VIEW` feature. If you use `LIVE VIEW`, upgrading to the new version will not be possible. [#88706](https://github.com/ClickHouse/ClickHouse/pull/88706) ([Alexey Milovidov](https://github.com/alexey-milovidov)).
* In previous versions, the `Geometry` type was aliased to `String`, but now it is a full-featured type. [#83344](https://github.com/ClickHouse/ClickHouse/pull/83344) ([scanhex12](https://github.com/scanhex12)).
* Escape filenames created for `Variant` type subcolumns in Wide data part of MergeTree tables. This change breaks compatibility with old tables with Variant/Dynamic/JSON data types. It fixes storing types with special symbols inside Variant (like DateTime with specific timezone that contains `\`). Escaping can be disabled by changing MergeTree setting `escape_variant_subcolumn_filenames` (to keep compatibility disable this setting in the config for MergeTree or set `compatibility` setting to the previous version before upgrade). Resolves [#69590](https://github.com/ClickHouse/ClickHouse/issues/69590). [#87300](https://github.com/ClickHouse/ClickHouse/pull/87300) ([Pavel Kruglov](https://github.com/Avogar)).
* Enable `with_size_stream` serialization format for the `String` data type by default. This change is backward compatible, but the new serialization format is supported only since version 25.10, which means that downgrading to versions before 25.10 will not be possible. If you want to keep the possibility of downgrading to 25.9 and earlier, configure `serialization_info_version` as `basic` and `string_serialization_version` as `single_stream` in the `merge_tree` section of the server configuration. [#89329](https://github.com/ClickHouse/ClickHouse/pull/89329) ([Alexey Milovidov](https://github.com/alexey-milovidov)).
* Support exception tagging for HTTP results response to enable clients to parse exceptions more reliably. Resolves [#75175](https://github.com/ClickHouse/ClickHouse/issues/75175). The setting `http_write_exception_in_output_format` is disabled by default for consistency across formats. [#88818](https://github.com/ClickHouse/ClickHouse/pull/88818) ([Kaviraj Kanagaraj](https://github.com/kavirajk)). Although it's not supposed to break any existing behavior (in the worst case, a weird string will be added to exception message), it still makes sense to use "Backward Incompatible Change" as the changelog category just for awareness (because who knows how some trash-scripts may parse the exception message).
* Prohibit the creation of multiple `plain-rewritable` disks on top of the shared object storage path, as this can lead to undefined behavior during collisions of different metadata storage transactions. [#89038](https://github.com/ClickHouse/ClickHouse/pull/89038) ([Mikhail Artemenko](https://github.com/Michicosun)).
* Fixes Kafka storage SASL settings precedence. Table-level SASL settings specified in CREATE TABLE queries now correctly override consumer/producer-specific settings from configuration files. [#89401](https://github.com/ClickHouse/ClickHouse/pull/89401) ([János Benjamin Antal](https://github.com/antaljanosbenjamin)).
* Parquet no-timezone timestamps (isAdjustedToUTC=false) are now read as DateTime64(..., 'UTC') instead of DateTime64(...). This is less incorrect as converting such UTC timestamp to string produces a representation of the correct local time. Use `input_format_parquet_local_time_as_utc = 0` to get the old behavior. Resolves [#87469](https://github.com/ClickHouse/ClickHouse/issues/87469). [#87872](https://github.com/ClickHouse/ClickHouse/pull/87872) ([Michael Kolupaev](https://github.com/al13n321)).
* A small improvement for `T64` codec: it no longer accepts data types unaligned with the compression element size, which otherwise triggers a bug. Resolves [#89282](https://github.com/ClickHouse/ClickHouse/issues/89282). [#89432](https://github.com/ClickHouse/ClickHouse/pull/89432) ([yanglongwei](https://github.com/ylw510)).

#### New Feature
* Some improvement.

