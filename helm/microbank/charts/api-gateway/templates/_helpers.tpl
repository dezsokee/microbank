{{- define "api-gateway.fullname" -}}
{{- printf "%s-api-gateway" .Release.Name -}}
{{- end -}}

{{- define "api-gateway.labels" -}}
app.kubernetes.io/name: api-gateway
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "api-gateway.selectorLabels" -}}
app.kubernetes.io/name: api-gateway
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
